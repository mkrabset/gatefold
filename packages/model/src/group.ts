import type { ComponentDef, Connection, Design, PinRef, Port } from './types'
import { inputPortId, outputPortId } from './types'

export interface InstancePin {
  instanceId: string
  portId: string
}

export interface InferredInput {
  source: PinRef
  targets: InstancePin[]
}

export interface InferredOutput {
  source: InstancePin
  targets: PinRef[]
}

export interface InferredGroup {
  internal: Connection[]
  inputs: InferredInput[]
  outputs: InferredOutput[]
}

function pinKey(ref: PinRef): string {
  return ref.kind === 'instance' ? `${ref.instanceId}:${ref.portId}` : `port:${ref.portId}`
}

function nextId(existing: Set<string>, base: string): string {
  if (!existing.has(base)) return base
  let i = 2
  while (existing.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

function clonePinRef(ref: PinRef): PinRef {
  return ref.kind === 'instance'
    ? { kind: 'instance', instanceId: ref.instanceId, portId: ref.portId }
    : { kind: 'port', portId: ref.portId }
}

function cloneDef(def: ComponentDef): ComponentDef {
  return {
    ...def,
    ports: def.ports.map((p) => ({ ...p })),
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
    const fromSel = c.from.kind === 'instance' && selected.has(c.from.instanceId)
    const toSel = c.to.kind === 'instance' && selected.has(c.to.instanceId)

    if (fromSel && toSel) {
      internal.push(c)
    } else if (toSel && c.to.kind === 'instance') {
      const key = pinKey(c.from)
      const entry = inputs.get(key) ?? { source: clonePinRef(c.from), targets: [] }
      entry.targets.push({ instanceId: c.to.instanceId, portId: c.to.portId })
      inputs.set(key, entry)
    } else if (fromSel && c.from.kind === 'instance') {
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

  const ports: Port[] = []
  inferred.inputs.forEach((_, i) => {
    ports.push({ id: inputPortId(i), name: inputNames[i] || `in${i + 1}`, direction: 'input' })
  })
  inferred.outputs.forEach((_, i) => {
    ports.push({ id: outputPortId(i), name: outputNames[i] || `out${i + 1}`, direction: 'output' })
  })

  const connections: Connection[] = inferred.internal.map((c) => ({
    id: c.id,
    from: clonePinRef(c.from),
    to: clonePinRef(c.to),
  }))
  let connCounter = 0
  const genConn = () => `c-${newDefId}-${++connCounter}`

  inferred.inputs.forEach((g, i) => {
    for (const t of g.targets) {
      connections.push({
        id: genConn(),
        from: { kind: 'port', portId: inputPortId(i) },
        to: { kind: 'instance', instanceId: t.instanceId, portId: t.portId },
      })
    }
  })
  inferred.outputs.forEach((g, i) => {
    connections.push({
      id: genConn(),
      from: { kind: 'instance', instanceId: g.source.instanceId, portId: g.source.portId },
      to: { kind: 'port', portId: outputPortId(i) },
    })
  })

  const movedInstances = def.instances?.filter((i) => selected.has(i.id)) ?? []
  const cx = movedInstances.reduce((s, i) => s + i.pos.x, 0) / (movedInstances.length || 1)
  const cy = movedInstances.reduce((s, i) => s + i.pos.y, 0) / (movedInstances.length || 1)

  result.defs[newDefId] = {
    id: newDefId,
    name: defName,
    kind: 'composite',
    ports,
    instances: movedInstances,
    connections,
  }

  const remaining = def.instances?.filter((i) => !selected.has(i.id)) ?? []
  const instName = nextId(new Set(remaining.map((i) => i.name)), defName)
  const instId = nextId(new Set(remaining.map((i) => i.id)), `${defName}-i`)

  const external: Connection[] = []
  let extCounter = 0
  const genExt = () => `e-${++extCounter}`

  inferred.inputs.forEach((g, i) => {
    external.push({
      id: genExt(),
      from: g.source,
      to: { kind: 'instance', instanceId: instId, portId: inputPortId(i) },
    })
  })
  inferred.outputs.forEach((g, i) => {
    for (const t of g.targets) {
      external.push({
        id: genExt(),
        from: { kind: 'instance', instanceId: instId, portId: outputPortId(i) },
        to: t,
      })
    }
  })

  const keptConnections = (def.connections ?? []).filter((c) => {
    const touches = (r: PinRef) => r.kind === 'instance' && selected.has(r.instanceId)
    return !touches(c.from) && !touches(c.to)
  })

  def.instances = [...remaining, { id: instId, name: instName, defId: newDefId, pos: { x: cx, y: cy } }]
  def.connections = [...keptConnections, ...external]

  return result
}
