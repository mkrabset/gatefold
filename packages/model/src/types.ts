/**
 * Core domain model for Gatefold.
 *
 * A design is a registry of component *definitions* (`ComponentDef`). A composite
 * definition describes its internals as a graph of *instances* wired together by
 * *connections*. Definitions are types; instances are concrete usages. Everything
 * here is plain data with no UI or framework dependencies.
 */

/** 3-state logic value: `0` low, `1` high, `'x'` unknown/floating. */
export type Signal = 0 | 1 | 'x'

/** Which edge of a component a terminal sits on: inputs flow in, outputs flow out. */
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

/** The discriminant for the built-in primitive registry: one kind per `Primitive` class. */
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

/** A per-instance custom property value (JSON-scalar only, so props round-trip verbatim). */
export type PropertyValue = number | string | boolean

/** A built-in component definition (a serializable reference to its primitive kind). */
export interface PrimitiveDef {
  id: string
  name: string
  kind: 'primitive'
  primitive: PrimitiveKind
  ports: Port[]
  /** True when this def is an instance-local fork (hidden from the library). */
  variant?: boolean
  /** Lineage id: shared by a template and every variant copied from it. */
  uuid?: string
}

/** A user-defined composite definition: a graph of instances wired by connections. */
export interface CompositeDef {
  id: string
  name: string
  kind: 'composite'
  ports: Port[]
  instances?: Instance[]
  connections?: Connection[]
  /** True when this def is an instance-local fork (hidden from the library). */
  variant?: boolean
  /** Lineage id: shared by a template and every variant copied from it. */
  uuid?: string
  /** User-defined grouping shown in the library; `undefined` = Uncategorized. */
  category?: string
}

/**
 * A component definition: a *type* (primitive or composite). Instances reference a
 * definition by `id`; the `kind` discriminates which arm is present.
 */
export type ComponentDef = PrimitiveDef | CompositeDef

export interface Instance {
  id: string
  name: string
  defId: string
  pos: { x: number; y: number }
  /** Per-instance custom property values (keys match the primitive's `properties()`). */
  props?: Record<string, PropertyValue>
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

/** The whole document: a registry of component definitions plus the root sheet id. */
export interface Design {
  version: number
  root: string
  defs: Record<string, ComponentDef>
}

/** The id of the `index`-th input terminal (`in:0`, `in:1`, …). */
export const inputPortId = (index: number) => `in:${index}`
/** The id of the `index`-th output terminal (`out:0`, `out:1`, …). */
export const outputPortId = (index: number) => `out:${index}`

/** A definition's input ports (in declared order). */
export function inputPorts(def: ComponentDef): Port[] {
  return def.ports.filter((p) => p.direction === 'input')
}

/** A definition's output ports (in declared order). */
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

/** Produce the next free connection id (`c1`, `c2`, …), skipping any collisions. */
export function nextConnectionId(connections: Connection[]): string {
  const ids = new Set(connections.map((c) => c.id))
  let i = connections.length + 1
  while (ids.has(`c${i}`)) i++
  return `c${i}`
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
 * `defId`, in def-then-instance order. Only composites contain instances, so each
 * returned def is a composite.
 */
export function instancesReferencing(design: Design, defId: string): { def: CompositeDef; instance: Instance }[] {
  const refs: { def: CompositeDef; instance: Instance }[] = []
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

/** The category shown for a template with no explicit `category` assigned. */
export const UNCATEGORIZED = 'Uncategorized'

/** A template's library category, defaulting to `UNCATEGORIZED` when unset or blank. */
export function templateCategory(def: CompositeDef): string {
  return def.category?.trim() || UNCATEGORIZED
}
