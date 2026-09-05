import type { ChildDef, CompositeDef, Connection, Design, Instance, PinRef, Port } from './types'
import { findConnectionTo, inputPortId, inputPorts, outputPortId, outputPorts, pinKey, pinRefEquals, templateNames } from './types'
import { allCompositeIds, findComposite, uniqueId, newUuid } from './util'
import { childPorts, isPortGroupDef, portGroupDirection } from './primitives'

/**
 * Pure "group into composite" logic.
 *
 * Grouping turns a selection of instances inside a composite into a new composite
 * definition: the selected instances move into the new def, wires that stay within
 * the selection become internal, and wires crossing the boundary are routed through
 * the new component's input/output ports. Composite ports are modeled as instances
 * of the special `input-port`/`output-port` primitives, so all wiring stays plain
 * instance-pin connections. `inferGroup` inspects the parent composite (used to
 * populate the naming dialog); `applyGroup` produces the transformed design.
 */

export interface InstancePin {
  instanceId: string
  portId: string
}

/** An inferred input: one external net feeding one or more selected input pins. */
export interface InferredInput {
  /** The external pin driving this input, or undefined for an exposed (unconnected) input. */
  source?: InstancePin
  targets: InstancePin[]
  /** Inherited terminal name (when the parent's input-port is included in the group). */
  name?: string
  /** Inherited terminal inversion (when the parent's input-port is included in the group). */
  inverted?: boolean
}

/** An inferred output: one selected output pin driving one or more external pins. */
export interface InferredOutput {
  /** The selected pin driving this output, or undefined for an output with no driver. */
  source?: InstancePin
  /** The external pins driven by this output; empty for an exposed (unconnected) output. */
  targets: InstancePin[]
  /** Inherited terminal name (when the parent's output-port is included in the group). */
  name?: string
  /** Inherited terminal inversion (when the parent's output-port is included in the group). */
  inverted?: boolean
}

export interface InferredGroup {
  internal: Connection[]
  inputs: InferredInput[]
  outputs: InferredOutput[]
  /** True when the parent's `input-port` instance is part of the selection. */
  inputPortIncluded: boolean
  /** True when the parent's `output-port` instance is part of the selection. */
  outputPortIncluded: boolean
}

// The transformation below clones the design so `applyGroup` stays a pure function
// (no mutation of its input). These helpers do a manual deep clone of the model.
function clonePinRef(ref: PinRef): PinRef {
  return { instanceId: ref.instanceId, portId: ref.portId }
}

function clonePort(port: Port): Port {
  return { ...port, terminal: port.terminal ? { ...port.terminal } : undefined }
}

/** Deep-clone a child def, assigning fresh composite ids from `usedIds` (built-ins stay
 *  shared; forks copy their ports; composites recurse). Instance ids are local to their
 *  parent composite and are preserved, so `Port.terminal` back-references stay valid. */
export function cloneChildDef(def: ChildDef, usedIds: Set<string>): ChildDef {
  if (def.kind === 'builtin') return { kind: 'builtin', primitive: def.primitive }
  if (def.kind === 'fork') return { kind: 'fork', primitive: def.primitive, ports: def.ports.map(clonePort) }
  return cloneComposite(def, usedIds)
}

/** Deep-clone a composite, assigning it (and its nested composites) fresh unique ids. */
export function cloneComposite(def: CompositeDef, usedIds: Set<string>): CompositeDef {
  const id = uniqueId(usedIds, def.id, '~')
  usedIds.add(id)
  return {
    kind: 'composite',
    id,
    name: def.name,
    ...(def.uuid ? { uuid: def.uuid } : {}),
    ...(def.category ? { category: def.category } : {}),
    ports: def.ports.map(clonePort),
    instances: def.instances.map((inst) => ({
      id: inst.id,
      name: inst.name,
      pos: { ...inst.pos },
      ...(inst.props ? { props: { ...inst.props } } : {}),
      def: cloneChildDef(inst.def, usedIds),
    })),
    connections: def.connections.map((c) => ({ id: c.id, from: clonePinRef(c.from), to: clonePinRef(c.to) })),
  }
}

/** Deep-clone a whole design (ids are preserved because `uniqueId` returns the base id
 *  when it does not collide with the empty `usedIds`). */
export function cloneDesign(design: Design): Design {
  const usedIds = new Set<string>()
  const root = cloneComposite(design.root, usedIds)
  const library: Record<string, CompositeDef> = {}
  for (const def of Object.values(design.library)) {
    const copy = cloneComposite(def, usedIds)
    library[copy.id] = copy
  }
  return { version: design.version, root, library }
}

/**
 * Classify the connections of `def` relative to the selected instances and infer the
 * composite's input/output ports from the wires crossing the selection boundary, plus
 * the selected instances' unconnected pins (so floating inputs become input terminals
 * and unused outputs become output terminals, wired only internally).
 */
export function inferGroup(def: CompositeDef, instanceIds: string[]): InferredGroup {
  const selected = new Set(instanceIds)
  const internal: Connection[] = []
  const inputs = new Map<string, InferredInput>()
  const outputs = new Map<string, InferredOutput>()

  const isPortGroupInst = (instanceId: string): boolean => {
    const inst = def.instances.find((i) => i.id === instanceId)
    return !!inst && isPortGroupDef(inst.def)
  }

  // If the parent's input-port / output-port instance is included, the new component
  // inherits the parent's interface (count + names) instead of inferring it from wiring.
  const inputPortInst = def.instances.find((i) => portGroupDirection(i.def) === 'input')
  const outputPortInst = def.instances.find((i) => portGroupDirection(i.def) === 'output')
  const inputPortIncluded = !!inputPortInst && selected.has(inputPortInst.id)
  const outputPortIncluded = !!outputPortInst && selected.has(outputPortInst.id)

  for (const c of def.connections) {
    // Port-group instances are never "inside" a selection — their connections define
    // the interface instead.
    const fromSel = selected.has(c.from.instanceId) && !isPortGroupInst(c.from.instanceId)
    const toSel = selected.has(c.to.instanceId) && !isPortGroupInst(c.to.instanceId)

    // Three cases: fully inside the selection (internal), crossing into it (input),
    // or leaving it (output). Connections that don't touch the selection are ignored.
    if (fromSel && toSel) {
      internal.push(c)
    } else if (toSel) {
      // When the input-port is included, its pins are handled by the inherited-input
      // derivation below; only other external sources become crossing inputs here.
      if (inputPortIncluded && inputPortInst && c.from.instanceId === inputPortInst.id) continue
      const key = pinKey(c.from)
      const entry = inputs.get(key) ?? { source: clonePinRef(c.from), targets: [] }
      entry.targets.push({ instanceId: c.to.instanceId, portId: c.to.portId })
      inputs.set(key, entry)
    } else if (fromSel) {
      if (outputPortIncluded && outputPortInst && c.to.instanceId === outputPortInst.id) continue
      const key = pinKey(c.from)
      const entry = outputs.get(key) ?? { source: { instanceId: c.from.instanceId, portId: c.from.portId }, targets: [] }
      entry.targets.push(clonePinRef(c.to))
      outputs.set(key, entry)
    }
  }

  // Exposed (unconnected) pins: an input with no incoming wire becomes an input
  // terminal (so it can be driven later); an output with no outgoing wire becomes an
  // output terminal (so it can be used later). Disabled on a side whose port group is
  // included — that side's interface is inherited instead.
  const exposedInputs: InferredInput[] = []
  const exposedOutputs: InferredOutput[] = []
  for (const inst of def.instances) {
    if (!selected.has(inst.id) || isPortGroupInst(inst.id)) continue
    const ports = childPorts(inst.def)
    if (!inputPortIncluded) {
      for (const port of inputPorts(ports)) {
        const ref = { instanceId: inst.id, portId: port.id }
        if (!findConnectionTo(def.connections, ref)) exposedInputs.push({ targets: [ref] })
      }
    }
    if (!outputPortIncluded) {
      for (const port of outputPorts(ports)) {
        const ref = { instanceId: inst.id, portId: port.id }
        if (!def.connections.some((c) => pinRefEquals(c.from, ref))) exposedOutputs.push({ source: ref, targets: [] })
      }
    }
  }

  // Inherited interface: each parent input/output port becomes a terminal with the
  // parent's name. Every parent port is kept, even if currently unwired.
  const inheritedInputs: InferredInput[] = []
  if (inputPortIncluded && inputPortInst) {
    for (const p of inputPorts(def.ports)) {
      const source = { instanceId: inputPortInst.id, portId: p.id }
      const targets = def.connections
        .filter(
          (c) =>
            c.from.instanceId === inputPortInst.id &&
            c.from.portId === p.id &&
            selected.has(c.to.instanceId) &&
            !isPortGroupInst(c.to.instanceId),
        )
        .map((c) => ({ instanceId: c.to.instanceId, portId: c.to.portId }))
      inheritedInputs.push({ name: p.name, inverted: p.inverted, source, targets })
    }
  }
  const inheritedOutputs: InferredOutput[] = []
  if (outputPortIncluded && outputPortInst) {
    for (const p of outputPorts(def.ports)) {
      const target = { instanceId: outputPortInst.id, portId: p.id }
      const driver = def.connections.find(
        (c) =>
          c.to.instanceId === outputPortInst.id &&
          c.to.portId === p.id &&
          selected.has(c.from.instanceId) &&
          !isPortGroupInst(c.from.instanceId),
      )
      inheritedOutputs.push({
        name: p.name,
        inverted: p.inverted,
        source: driver ? { instanceId: driver.from.instanceId, portId: driver.from.portId } : undefined,
        targets: [target],
      })
    }
  }

  return {
    internal,
    inputs: [...inheritedInputs, ...inputs.values(), ...exposedInputs],
    outputs: [...inheritedOutputs, ...outputs.values(), ...exposedOutputs],
    inputPortIncluded,
    outputPortIncluded,
  }
}

/**
 * Create a new composite component from the selected instances and return a new design.
 * Boundary wires are rewired through the new component's ports. `parentId` locates the
 * composite being edited (root, a template, or a live copy). `defName` is the
 * user-supplied component name (defaults to "component", uniquified on collision).
 */
export function applyGroup(
  design: Design,
  parentId: string,
  instanceIds: string[],
  inputNames: string[],
  outputNames: string[],
  defName = 'component',
): Design {
  const result = cloneDesign(design)
  const parent = findComposite(result, parentId)
  if (!parent) throw new Error('group: parent is not a composite')
  const inferred = inferGroup(parent, instanceIds)
  if (inputNames.length !== inferred.inputs.length || outputNames.length !== inferred.outputs.length) {
    throw new Error('group: port name count does not match inferred ports')
  }

  // Port-group instances are not moved into the new component — they stay in the
  // parent and define the interface instead.
  const isPortGroupInst = (id: string): boolean => {
    const inst = parent.instances.find((i) => i.id === id)
    return !!inst && isPortGroupDef(inst.def)
  }
  const movable = new Set(instanceIds.filter((id) => !isPortGroupInst(id)))

  const finalName = uniqueId(templateNames(result), defName.trim() || 'component')
  const newDefId = uniqueId(allCompositeIds(result), finalName)

  // Centroid of the selection — used to place the new instance in the parent and as
  // the anchor for auto-placing the port instances.
  const movedInstances = parent.instances.filter((i) => movable.has(i.id))
  const cx = movedInstances.reduce((s, i) => s + i.pos.x, 0) / (movedInstances.length || 1)
  const cy = movedInstances.reduce((s, i) => s + i.pos.y, 0) / (movedInstances.length || 1)

  // Build the ports and their internal port-group instances, wired to the moved pins.
  const ports: Port[] = []
  const portInstances: Instance[] = []
  const connections: Connection[] = inferred.internal.map((c) => ({
    id: c.id,
    from: clonePinRef(c.from),
    to: clonePinRef(c.to),
  }))
  let connCounter = 0
  const genConn = () => `c-${newDefId}-${++connCounter}`

  const inputGroupId = inferred.inputs.length > 0 ? `${newDefId}-in` : null
  const outputGroupId = inferred.outputs.length > 0 ? `${newDefId}-out` : null

  const inputPortInst = parent.instances.find((i) => portGroupDirection(i.def) === 'input')
  const outputPortInst = parent.instances.find((i) => portGroupDirection(i.def) === 'output')

  if (inputGroupId) {
    const pos = inferred.inputPortIncluded && inputPortInst
      ? { x: inputPortInst.pos.x, y: inputPortInst.pos.y }
      : { x: cx - 120, y: cy }
    portInstances.push({ id: inputGroupId, name: '', def: { kind: 'builtin', primitive: 'input-port' }, pos })
  }
  if (outputGroupId) {
    const pos = inferred.outputPortIncluded && outputPortInst
      ? { x: outputPortInst.pos.x, y: outputPortInst.pos.y }
      : { x: cx + 120, y: cy }
    portInstances.push({ id: outputGroupId, name: '', def: { kind: 'builtin', primitive: 'output-port' }, pos })
  }

  inferred.inputs.forEach((g, i) => {
    const name = inputNames[i] || `in${i + 1}`
    const groupId = inputGroupId ?? `${newDefId}-in`
    ports.push({
      id: inputPortId(i),
      name,
      direction: 'input',
      terminal: { instanceId: groupId, pinId: inputPortId(i) },
    })
    for (const t of g.targets) {
      connections.push({
        id: genConn(),
        from: { instanceId: groupId, portId: inputPortId(i) },
        to: { instanceId: t.instanceId, portId: t.portId },
      })
    }
  })

  inferred.outputs.forEach((g, i) => {
    const name = outputNames[i] || `out${i + 1}`
    const groupId = outputGroupId ?? `${newDefId}-out`
    ports.push({
      id: outputPortId(i),
      name,
      direction: 'output',
      terminal: { instanceId: groupId, pinId: outputPortId(i) },
    })
    if (g.source) {
      connections.push({
        id: genConn(),
        from: { instanceId: g.source.instanceId, portId: g.source.portId },
        to: { instanceId: groupId, portId: outputPortId(i) },
      })
    }
  })

  // The new template is an origin: it lives in the library and owns its moved
  // instances (their inline defs) directly.
  const template: CompositeDef = {
    kind: 'composite',
    id: newDefId,
    name: finalName,
    ports,
    instances: [...movedInstances, ...portInstances],
    connections,
    uuid: newUuid(),
  }
  result.library[newDefId] = template

  const remaining = parent.instances.filter((i) => !movable.has(i.id))
  const instId = uniqueId(new Set(remaining.map((i) => i.id)), `${finalName}-i`)

  // Re-wire the parent: each external input net now drives the new instance's input
  // port, and each external target is now driven by the new instance's output port.
  const external: Connection[] = []
  let extCounter = 0
  const genExt = () => `e-${++extCounter}`

  inferred.inputs.forEach((g, i) => {
    if (!g.source) return
    external.push({
      id: genExt(),
      from: g.source,
      to: { instanceId: instId, portId: inputPortId(i) },
    })
  })
  inferred.outputs.forEach((g, i) => {
    for (const t of g.targets) {
      external.push({
        id: genExt(),
        from: { instanceId: instId, portId: outputPortId(i) },
        to: t,
      })
    }
  })

  const keptConnections = parent.connections.filter((c) => {
    return !movable.has(c.from.instanceId) && !movable.has(c.to.instanceId)
  })

  parent.instances = [...remaining, { id: instId, name: '', def: template, pos: { x: cx, y: cy } }]
  parent.connections = [...keptConnections, ...external]

  return result
}
