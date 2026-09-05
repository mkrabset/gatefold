import type { ComponentDef, Connection, Design, Instance, PinRef, Port } from './types'
import { findConnectionTo, getDef, inputPortId, inputPorts, outputPortId, outputPorts, pinKey, pinRefEquals, templateNames } from './types'
import { collectClosure, combinedDefs, uniqueId, newUuid } from './util'
import { isPortGroupDef, portGroupDirection } from './primitives'

/**
 * Pure "group into composite" logic.
 *
 * Grouping turns a selection of instances inside a composite into a new composite
 * definition: the selected instances move into the new def, wires that stay within
 * the selection become internal, and wires crossing the boundary are routed through
 * the new component's input/output ports. Composite ports are modeled as instances
 * of the special `input-port`/`output-port` primitives, so all wiring stays plain
 * instance-pin connections. `inferGroup` inspects the current design (used to
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

/** Deep-clone a single component definition. */
export function cloneDef(def: ComponentDef): ComponentDef {
  const ports = def.ports.map((p) => ({ ...p, terminal: p.terminal ? { ...p.terminal } : undefined }))
  if (def.kind === 'primitive') return { ...def, ports }
  return {
    ...def,
    ports,
    instances: def.instances?.map((i) => ({
      ...i,
      pos: { ...i.pos },
      props: i.props ? { ...i.props } : undefined,
    })),
    connections: def.connections?.map((c) => ({ id: c.id, from: clonePinRef(c.from), to: clonePinRef(c.to) })),
  }
}

/** Deep-clone a whole design. */
export function cloneDesign(design: Design): Design {
  return {
    version: design.version,
    root: design.root,
    library: Object.fromEntries(Object.entries(design.library).map(([k, def]) => [k, cloneDef(def)])),
    defs: Object.fromEntries(Object.entries(design.defs).map(([k, def]) => [k, cloneDef(def)])),
  }
}

/** Predicate: is `instanceId` a port-group instance (input-port / output-port)? */
function portGroupInstPredicate(instances: Instance[], defs: Record<string, ComponentDef>): (instanceId: string) => boolean {
  const byId = new Map(instances.map((i) => [i.id, i]))
  return (instanceId) => {
    const inst = byId.get(instanceId)
    if (!inst) return false
    const idef = defs[inst.defId]
    return !!idef && isPortGroupDef(idef)
  }
}

/** The port-group direction of the def referenced by `instanceId`, or null. */
function portGroupOf(defs: Record<string, ComponentDef>, instanceId: string): 'input' | 'output' | null {
  const idef = defs[instanceId]
  return idef ? portGroupDirection(idef) : null
}

/**
 * Move the given defs (and their transitive instance closure) from the content tree into
 * the library, so a template that references them stays self-contained. Canonical
 * built-ins (`id === primitive`, including the port groups) are left in the content tree.
 */
function relocateToLibrary(result: Design, rootIds: string[]): void {
  const closure = collectClosure(result.defs, rootIds, (def) => def.kind === 'primitive' && def.id === def.primitive)
  for (const id of closure) {
    const def = result.defs[id]
    if (def) {
      result.library[id] = def
      delete result.defs[id]
    }
  }
}

/**
 * Classify the connections of `defId` relative to the selected instances and infer the
 * composite's input/output ports from the wires crossing the selection boundary, plus
 * the selected instances' unconnected pins (so floating inputs become input terminals
 * and unused outputs become output terminals, wired only internally).
 */
export function inferGroup(design: Design, defId: string, instanceIds: string[]): InferredGroup {
  const selected = new Set(instanceIds)
  const defs = combinedDefs(design)
  const def = defs[defId]
  const internal: Connection[] = []
  const inputs = new Map<string, InferredInput>()
  const outputs = new Map<string, InferredOutput>()
  if (!def || def.kind !== 'composite') {
    return { internal, inputs: [], outputs: [], inputPortIncluded: false, outputPortIncluded: false }
  }

  const isPortGroupInst = portGroupInstPredicate(def.instances ?? [], defs)

  // If the parent's input-port / output-port instance is included, the new component
  // inherits the parent's interface (count + names) instead of inferring it from wiring.
  const inputPortInst = (def.instances ?? []).find((i) => portGroupOf(defs, i.defId) === 'input')
  const outputPortInst = (def.instances ?? []).find((i) => portGroupOf(defs, i.defId) === 'output')
  const inputPortIncluded = !!inputPortInst && selected.has(inputPortInst.id)
  const outputPortIncluded = !!outputPortInst && selected.has(outputPortInst.id)

  for (const c of def.connections ?? []) {
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
      // An external source feeding a selected input pin. Group by the source net so
      // several pins driven by the same net collapse into a single input port.
      const key = pinKey(c.from)
      const entry = inputs.get(key) ?? { source: clonePinRef(c.from), targets: [] }
      entry.targets.push({ instanceId: c.to.instanceId, portId: c.to.portId })
      inputs.set(key, entry)
    } else if (fromSel) {
      // When the output-port is included, its pins are handled by the inherited-output
      // derivation below.
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
  for (const inst of def.instances ?? []) {
    if (!selected.has(inst.id) || isPortGroupInst(inst.id)) continue
    const instDef = defs[inst.defId]
    if (!instDef) continue
    if (!inputPortIncluded) {
      for (const port of inputPorts(instDef)) {
        const ref = { instanceId: inst.id, portId: port.id }
        if (!findConnectionTo(def.connections ?? [], ref)) {
          exposedInputs.push({ targets: [ref] })
        }
      }
    }
    if (!outputPortIncluded) {
      for (const port of outputPorts(instDef)) {
        const ref = { instanceId: inst.id, portId: port.id }
        if (!(def.connections ?? []).some((c) => pinRefEquals(c.from, ref))) {
          exposedOutputs.push({ source: ref, targets: [] })
        }
      }
    }
  }

  // Inherited interface: each parent input/output port becomes a terminal with the
  // parent's name. Every parent port is kept, even if currently unwired.
  const inheritedInputs: InferredInput[] = []
  if (inputPortIncluded && inputPortInst) {
    for (const p of inputPorts(def)) {
      const source = { instanceId: inputPortInst.id, portId: p.id }
      const targets = (def.connections ?? [])
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
    for (const p of outputPorts(def)) {
      const target = { instanceId: outputPortInst.id, portId: p.id }
      const driver = (def.connections ?? []).find(
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
 * Boundary wires are rewired through the new component's ports. `defName` is the
 * user-supplied component name (defaults to "component", uniquified on collision).
 */
export function applyGroup(
  design: Design,
  defId: string,
  instanceIds: string[],
  inputNames: string[],
  outputNames: string[],
  defName = 'component',
): Design {
  const inferred = inferGroup(design, defId, instanceIds)
  if (inputNames.length !== inferred.inputs.length || outputNames.length !== inferred.outputs.length) {
    throw new Error('group: port name count does not match inferred ports')
  }

  const result = cloneDesign(design)
  const def = getDef(result, defId)
  if (!def || def.kind !== 'composite') throw new Error('group: parent is not a composite')
  const defs = combinedDefs(result)

  // Port-group instances are not moved into the new component — they stay in the
  // parent and define the interface instead.
  const isPortGroupInst = portGroupInstPredicate(def.instances ?? [], defs)
  const movable = new Set(instanceIds.filter((id) => !isPortGroupInst(id)))

  const existingNames = templateNames(result)
  const finalName = uniqueId(existingNames, defName.trim() || 'component')
  const newDefId = uniqueId(new Set(Object.keys(defs)), finalName)

  // Centroid of the selection — used to place the new instance in the parent and as
  // the anchor for auto-placing the port instances.
  const movedInstances = def.instances?.filter((i) => movable.has(i.id)) ?? []
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

  // One input-port instance carries all inferred inputs; one output-port instance all
  // inferred outputs. Their pins are derived from the composite's ports. When the
  // parent's own port group was included in the selection, the new group keeps its
  // original position (so ports stay put relative to the moved components); otherwise a
  // rough placeholder is used and the app re-places it.
  const inputGroupId = inferred.inputs.length > 0 ? `${newDefId}-in` : null
  const outputGroupId = inferred.outputs.length > 0 ? `${newDefId}-out` : null

  const inputPortInst = (def.instances ?? []).find((i) => portGroupOf(defs, i.defId) === 'input')
  const outputPortInst = (def.instances ?? []).find((i) => portGroupOf(defs, i.defId) === 'output')

  if (inputGroupId) {
    const pos = inferred.inputPortIncluded && inputPortInst
      ? { x: inputPortInst.pos.x, y: inputPortInst.pos.y }
      : { x: cx - 120, y: cy }
    portInstances.push({ id: inputGroupId, name: '', defId: 'input-port', pos })
  }
  if (outputGroupId) {
    const pos = inferred.outputPortIncluded && outputPortInst
      ? { x: outputPortInst.pos.x, y: outputPortInst.pos.y }
      : { x: cx + 120, y: cy }
    portInstances.push({ id: outputGroupId, name: '', defId: 'output-port', pos })
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

  // The new template is an origin: it lives in the library, and the moved instances'
  // defs (their transitive closure) are relocated from the content tree into the library
  // so the template is self-contained.
  relocateToLibrary(result, movedInstances.map((i) => i.defId))

  result.library[newDefId] = {
    id: newDefId,
    name: finalName,
    kind: 'composite',
    ports,
    instances: [...movedInstances, ...portInstances],
    connections,
    uuid: newUuid(),
  }

  const remaining = def.instances?.filter((i) => !movable.has(i.id)) ?? []
  const instId = uniqueId(new Set(remaining.map((i) => i.id)), `${finalName}-i`)

  // Re-wire the parent: each external input net now drives the new instance's input
  // port, and each external target is now driven by the new instance's output port.
  const external: Connection[] = []
  let extCounter = 0
  const genExt = () => `e-${++extCounter}`

  inferred.inputs.forEach((g, i) => {
    // Exposed inputs have no external source — nothing to re-wire in the parent.
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

  const keptConnections = (def.connections ?? []).filter((c) => {
    return !movable.has(c.from.instanceId) && !movable.has(c.to.instanceId)
  })

  def.instances = [...remaining, { id: instId, name: '', defId: newDefId, pos: { x: cx, y: cy } }]
  def.connections = [...keptConnections, ...external]

  return result
}
