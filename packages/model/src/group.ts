import type { ComponentDef, Connection, Design, Instance, PinRef, Port } from './types'
import { inputPortId, outputPortId } from './types'

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
  source: InstancePin
  targets: InstancePin[]
}

/** An inferred output: one selected output pin driving one or more external pins. */
export interface InferredOutput {
  source: InstancePin
  targets: InstancePin[]
}

export interface InferredGroup {
  internal: Connection[]
  inputs: InferredInput[]
  outputs: InferredOutput[]
}

function pinKey(ref: PinRef): string {
  return `${ref.instanceId}:${ref.portId}`
}

// Produce a name/id that is unique against a set of existing ones, e.g. "component",
// "component-2", "component-3"…
function nextId(existing: Set<string>, base: string): string {
  if (!existing.has(base)) return base
  let i = 2
  while (existing.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

// The transformation below clones the design so `applyGroup` stays a pure function
// (no mutation of its input). These helpers do a manual deep clone of the model.
function clonePinRef(ref: PinRef): PinRef {
  return { instanceId: ref.instanceId, portId: ref.portId }
}

function cloneDef(def: ComponentDef): ComponentDef {
  return {
    ...def,
    ports: def.ports.map((p) => ({ ...p, terminal: p.terminal ? { ...p.terminal } : undefined })),
    instances: def.instances?.map((i) => ({ ...i, pos: { ...i.pos } })),
    connections: def.connections?.map((c) => ({ id: c.id, from: clonePinRef(c.from), to: clonePinRef(c.to) })),
  }
}

function cloneDesign(design: Design): Design {
  return {
    version: design.version,
    root: design.root,
    defs: Object.fromEntries(Object.entries(design.defs).map(([k, def]) => [k, cloneDef(def)])),
  }
}

/**
 * Classify the connections of `defId` relative to the selected instances and infer the
 * composite's input/output ports from the wires crossing the selection boundary.
 */
export function inferGroup(design: Design, defId: string, instanceIds: string[]): InferredGroup {
  const selected = new Set(instanceIds)
  const def = design.defs[defId]
  const internal: Connection[] = []
  const inputs = new Map<string, InferredInput>()
  const outputs = new Map<string, InferredOutput>()

  for (const c of def.connections ?? []) {
    const fromSel = selected.has(c.from.instanceId)
    const toSel = selected.has(c.to.instanceId)

    // Three cases: fully inside the selection (internal), crossing into it (input),
    // or leaving it (output). Connections that don't touch the selection are ignored.
    if (fromSel && toSel) {
      internal.push(c)
    } else if (toSel) {
      // An external source feeding a selected input pin. Group by the source net so
      // several pins driven by the same net collapse into a single input port.
      const key = pinKey(c.from)
      const entry = inputs.get(key) ?? { source: clonePinRef(c.from), targets: [] }
      entry.targets.push({ instanceId: c.to.instanceId, portId: c.to.portId })
      inputs.set(key, entry)
    } else if (fromSel) {
      const key = pinKey(c.from)
      const entry = outputs.get(key) ?? { source: { instanceId: c.from.instanceId, portId: c.from.portId }, targets: [] }
      entry.targets.push(clonePinRef(c.to))
      outputs.set(key, entry)
    }
  }

  return { internal, inputs: [...inputs.values()], outputs: [...outputs.values()] }
}

/**
 * Create a new composite component from the selected instances and return a new design.
 * Boundary wires are rewired through the new component's ports.
 */
export function applyGroup(
  design: Design,
  defId: string,
  instanceIds: string[],
  inputNames: string[],
  outputNames: string[],
): Design {
  const inferred = inferGroup(design, defId, instanceIds)
  if (inputNames.length !== inferred.inputs.length || outputNames.length !== inferred.outputs.length) {
    throw new Error('group: port name count does not match inferred ports')
  }

  const result = cloneDesign(design)
  const def = result.defs[defId]
  const selected = new Set(instanceIds)

  const existingNames = new Set(Object.values(result.defs).map((d) => d.name))
  const defName = nextId(existingNames, 'component')
  const newDefId = nextId(new Set(Object.keys(result.defs)), defName)

  // Centroid of the selection — used to place the new instance in the parent and as
  // the anchor for auto-placing the port instances.
  const movedInstances = def.instances?.filter((i) => selected.has(i.id)) ?? []
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
  // inferred outputs. Their pins are derived from the composite's ports.
  let inputGroupId: string | null = null
  let outputGroupId: string | null = null

  if (inferred.inputs.length > 0) {
    inputGroupId = `${newDefId}-in`
    portInstances.push({ id: inputGroupId, name: '', defId: 'input-port', pos: { x: cx - 120, y: cy } })
  }
  if (inferred.outputs.length > 0) {
    outputGroupId = `${newDefId}-out`
    portInstances.push({ id: outputGroupId, name: '', defId: 'output-port', pos: { x: cx + 120, y: cy } })
  }

  inferred.inputs.forEach((g, i) => {
    const name = inputNames[i] || `in${i + 1}`
    ports.push({ id: inputPortId(i), name, direction: 'input', terminal: { instanceId: inputGroupId!, pinId: inputPortId(i) } })
    for (const t of g.targets) {
      connections.push({
        id: genConn(),
        from: { instanceId: inputGroupId!, portId: inputPortId(i) },
        to: { instanceId: t.instanceId, portId: t.portId },
      })
    }
  })

  inferred.outputs.forEach((g, i) => {
    const name = outputNames[i] || `out${i + 1}`
    ports.push({ id: outputPortId(i), name, direction: 'output', terminal: { instanceId: outputGroupId!, pinId: outputPortId(i) } })
    connections.push({
      id: genConn(),
      from: { instanceId: g.source.instanceId, portId: g.source.portId },
      to: { instanceId: outputGroupId!, portId: outputPortId(i) },
    })
  })

  result.defs[newDefId] = {
    id: newDefId,
    name: defName,
    kind: 'composite',
    ports,
    instances: [...movedInstances, ...portInstances],
    connections,
  }

  const remaining = def.instances?.filter((i) => !selected.has(i.id)) ?? []
  const instName = nextId(new Set(remaining.map((i) => i.name)), defName)
  const instId = nextId(new Set(remaining.map((i) => i.id)), `${defName}-i`)

  // Re-wire the parent: each external input net now drives the new instance's input
  // port, and each external target is now driven by the new instance's output port.
  const external: Connection[] = []
  let extCounter = 0
  const genExt = () => `e-${++extCounter}`

  inferred.inputs.forEach((g, i) => {
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
    return !selected.has(c.from.instanceId) && !selected.has(c.to.instanceId)
  })

  def.instances = [...remaining, { id: instId, name: instName, defId: newDefId, pos: { x: cx, y: cy } }]
  def.connections = [...keptConnections, ...external]

  return result
}
