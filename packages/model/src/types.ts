/**
 * Core domain model for Gatefold.
 *
 * A design is a registry of component *definitions* (`ComponentDef`). A composite
 * definition describes its internals as a graph of *instances* wired together by
 * *connections*. Definitions are types; instances are concrete usages. Everything
 * here is plain data with no UI or framework dependencies.
 */

export type Signal = 0 | 1 | 'x'

export type PortDirection = 'input' | 'output'

/**
 * A named terminal on a component. `id` is stable (referenced by connections);
 * `name` is a user-facing label. Order within `ComponentDef.ports` (inputs first,
 * then outputs) determines their layout on the left/right edges.
 *
 * For composites, `terminal` links this declared port to the internal
 * `input-port`/`output-port` instance pin that represents it inside the definition.
 */
export interface Port {
  id: string
  name: string
  direction: PortDirection
  terminal?: { instanceId: string; pinId: string }
  /** True when the terminal is logically inverted (shown as a bubble). */
  inverted?: boolean
}

export type PrimitiveKind =
  | 'and'
  | 'or'
  | 'xor'
  | 'not'
  | 'buffer'
  | 'clock'
  | 'fan-in'
  | 'fan-out'
  | 'bus-split'
  | 'bus-merge'
  | 'bus'
  | 'input-port'
  | 'output-port'
  | 'seven-seg'
  | 'switch-array'
  | 'led-array'
  | 'dff'
  | 'join-point'

export interface ComponentDef {
  id: string
  name: string
  kind: 'primitive' | 'composite'
  primitive?: PrimitiveKind
  ports: Port[]
  instances?: Instance[]
  connections?: Connection[]
  /** True when this def is an instance-local fork (hidden from the library). */
  variant?: boolean
  /** Lineage id: shared by a template and every variant copied from it. */
  uuid?: string
}

export interface Instance {
  id: string
  name: string
  defId: string
  pos: { x: number; y: number }
  /** Per-instance custom property values (keys match the primitive's `properties()`). */
  props?: Record<string, unknown>
}

/**
 * A connection endpoint: a pin on a specific instance. Composite ports are modeled
 * as instances of the special `input-port`/`output-port` primitives, so every
 * endpoint is an instance pin — no special "port" case.
 */
export type PinRef = { instanceId: string; portId: string }

export interface Connection {
  id: string
  from: PinRef
  to: PinRef
}

export interface Design {
  version: number
  root: string
  defs: Record<string, ComponentDef>
}

export const inputPortId = (index: number) => `in:${index}`
export const outputPortId = (index: number) => `out:${index}`

export function inputPorts(def: ComponentDef): Port[] {
  return def.ports.filter((p) => p.direction === 'input')
}

export function outputPorts(def: ComponentDef): Port[] {
  return def.ports.filter((p) => p.direction === 'output')
}

/**
 * Produce a fresh, unused port id of the given direction. Used by the ports editor
 * so that added ports never collide with existing ids (which may have gaps after
 * removals).
 */
export function nextPortId(def: ComponentDef, direction: PortDirection): string {
  const prefix = direction === 'input' ? 'in' : 'out'
  const used = def.ports
    .filter((p) => p.direction === direction)
    .map((p) => {
      const idx = Number(p.id.split(':')[1])
      return Number.isFinite(idx) ? idx : -1
    })
  let i = 0
  while (used.includes(i)) i++
  return `${prefix}:${i}`
}

/** Structural equality for connection endpoints. */
export function pinRefEquals(a: PinRef, b: PinRef): boolean {
  return a.instanceId === b.instanceId && a.portId === b.portId
}

/** Canonical string key for a connection endpoint (instance + port). */
export function pinKey(ref: PinRef): string {
  return `${ref.instanceId}:${ref.portId}`
}

/**
 * The connection currently driving the sink `to`, or null. Enforces the
 * single-driver invariant: each input pin / composite output port has at most one
 * incoming connection.
 */
export function findConnectionTo(connections: Connection[], to: PinRef): Connection | null {
  return connections.find((c) => pinRefEquals(c.to, to)) ?? null
}

/**
 * Every (composite def, instance) pair across the design whose instance references
 * `defId`, in def-then-instance order.
 */
export function instancesReferencing(design: Design, defId: string): { def: ComponentDef; instance: Instance }[] {
  const refs: { def: ComponentDef; instance: Instance }[] = []
  for (const def of Object.values(design.defs)) {
    if (def.kind !== 'composite') continue
    for (const inst of def.instances ?? []) {
      if (inst.defId === defId) refs.push({ def, instance: inst })
    }
  }
  return refs
}

/** True when any instance in the design references `defId` via its `defId`. */
export function isDefReferenced(design: Design, defId: string): boolean {
  return instancesReferencing(design, defId).length > 0
}

/**
 * True for a reusable composite template: a non-root composite that is not an
 * instance-local variant copy (so it is listed in the library and editable).
 */
export function isTemplateDef(design: Design, def: ComponentDef): boolean {
  return def.kind === 'composite' && def.variant !== true && def.id !== design.root
}
