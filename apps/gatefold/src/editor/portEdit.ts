import type { ChildDef, CompositeDef, Instance, Port, PortDirection } from '@gatefold/model'
import {
  arrayDirection,
  arrayPorts,
  inputPorts,
  isArityFixed,
  isPortGroupDef,
  nextPortId,
  nextPrimitiveInputName,
  outputPorts,
  uniqueId,
} from '@gatefold/model'
import { instanceBounds } from './geometry'

/**
 * Port and terminal editing on child defs. These mutate the passed def/instance in
 * place (the store's immer wrapper makes that safe) and are called by the store's
 * `addPort`/`removePort`/`setInstanceProp`/`confirmGroup` actions, keeping that
 * orchestration out of the store body.
 */

/** Prune connections touching the given ports of `instanceId` from `parent`. */
export function pruneInstancePorts(parent: CompositeDef, instanceId: string, portIds: Set<string>): void {
  parent.connections = parent.connections.filter(
    (c) =>
      !(c.from.instanceId === instanceId && portIds.has(c.from.portId)) &&
      !(c.to.instanceId === instanceId && portIds.has(c.to.portId)),
  )
}

/** Set an array's terminal type, regenerating its ports and pruning all connections on change. */
export function applyArrayTerminalType(parentDef: CompositeDef, inst: Instance, terminalType: 'wire' | 'bus'): void {
  const def = inst.def
  if (def.kind !== 'fork') return
  if (!inst.props) inst.props = {}
  const prevType: 'wire' | 'bus' = inst.props.terminalType === 'wire' ? 'wire' : 'bus'
  inst.props.terminalType = terminalType
  def.ports = arrayPorts(arrayDirection(def), terminalType, 1)
  if (terminalType !== prevType) {
    parentDef.connections = parentDef.connections.filter(
      (c) => c.from.instanceId !== inst.id && c.to.instanceId !== inst.id,
    )
  }
}

/** Replace an array's WIRE ports with `count` lanes, pruning connections to removed ports. */
export function applyArrayPortCount(parentDef: CompositeDef, inst: Instance, count: number): void {
  const def = inst.def
  if (def.kind !== 'fork') return
  const newPorts = arrayPorts(arrayDirection(def), 'wire', count)
  const removed = new Set(def.ports.map((p) => p.id).filter((id) => !newPorts.some((p) => p.id === id)))
  def.ports = newPorts
  if (removed.size > 0) {
    parentDef.connections = parentDef.connections.filter(
      (c) => !(c.from.instanceId === inst.id && removed.has(c.from.portId)) && !(c.to.instanceId === inst.id && removed.has(c.to.portId)),
    )
  }
}

/** Default placement for a newly-added port group: just outside the component bounds
 *  (inputs to the left of the leftmost component, outputs to the right of the rightmost). */
export function portPlacement(def: CompositeDef, direction: PortDirection): { x: number; y: number } {
  const insts = def.instances
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const inst of insts) {
    // Ignore existing port groups so placement is relative to real components only.
    if (isPortGroupDef(inst.def)) continue
    const b = instanceBounds(def, inst, inst.def)
    minX = Math.min(minX, b.x)
    maxX = Math.max(maxX, b.x + b.w)
    minY = Math.min(minY, b.y)
    maxY = Math.max(maxY, b.y + b.h)
  }
  if (!Number.isFinite(minX)) {
    return { x: direction === 'input' ? -60 : 60, y: 0 }
  }
  const cy = (minY + maxY) / 2
  return { x: direction === 'input' ? minX - 80 : maxX + 80, y: cy }
}

/** The mutable ports array of a child def, or null when ports are derived (a built-in). */
export function mutablePorts(def: ChildDef): Port[] | null {
  if (def.kind === 'composite' || def.kind === 'fork') return def.ports
  return null
}

/** Add a port to `def` (a fork or the current composite), backing composites with a port-group pin. */
export function addPortToDef(def: ChildDef, direction: PortDirection): void {
  if (isArityFixed(def, direction)) return
  const ports = mutablePorts(def)
  if (!ports) return
  const count = direction === 'input' ? inputPorts(ports).length : outputPorts(ports).length
  const portId = nextPortId(ports, direction)
  const name = direction === 'input' ? nextPrimitiveInputName(def) ?? `in${count + 1}` : `out${count + 1}`
  let terminal: Port['terminal']
  if (def.kind === 'composite') {
    const groupKind = direction === 'input' ? 'input-port' : 'output-port'
    let group = def.instances.find((i) => i.def.kind === 'builtin' && i.def.primitive === groupKind)
    if (!group) {
      group = {
        id: uniqueId(new Set(def.instances.map((i) => i.id)), direction === 'input' ? 'port-in' : 'port-out', ''),
        name: '',
        def: { kind: 'builtin', primitive: groupKind },
        pos: portPlacement(def, direction),
      }
      def.instances.push(group)
    }
    terminal = { instanceId: group.id, pinId: portId }
  }
  const port: Port = { id: portId, name, direction, terminal }
  if (direction === 'input') {
    const outStart = ports.findIndex((p) => p.direction === 'output')
    if (outStart === -1) ports.push(port)
    else ports.splice(outStart, 0, port)
  } else {
    ports.push(port)
  }
}
