/**
 * Core domain model for Gatefold.
 *
 * A design is a tree of composite definitions. A composite owns its children as
 * inline objects: its `instances` carry an inline `ChildDef` (a shared built-in, an
 * owned primitive fork, or an owned composite). Definitions are types; instances are
 * concrete usages. Everything here is plain data with no UI or framework dependencies.
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

/**
 * A user-defined composite definition: a graph of instances wired by connections. Owns
 * its children inline — `instances` are the composite's internal components and
 * `connections` its internal wiring.
 */
export interface CompositeDef {
  kind: 'composite'
  id: string
  name: string
  ports: Port[]
  instances: Instance[]
  connections: Connection[]
  /**
   * Lineage id. On an origin template it is the template's identity; on a copy
   * (embedded in the library or live in the content tree) it is a soft link back to
   * the origin template that instantiated it. Cleared when the origin is deleted.
   */
  uuid?: string
  /** User-defined grouping shown in the library; `undefined` = Uncategorized. */
  category?: string
}

/**
 * A child of a composite instance: either a shared built-in primitive (referenced by
 * kind — the port groups and the join-point, whose ports are derived), an owned
 * primitive fork (a placed primitive whose `ports` carry its per-instance inversion /
 * arity), or an owned composite.
 */
export type ChildDef =
  | { kind: 'builtin'; primitive: PrimitiveKind }
  | { kind: 'fork'; primitive: PrimitiveKind; ports: Port[] }
  | CompositeDef

export interface Instance {
  id: string
  name: string
  pos: { x: number; y: number }
  /** The owned child definition (built-in reference, primitive fork, or composite). */
  def: ChildDef
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

/**
 * The whole document: the root composite (the content tree) plus the component
 * library (templates). Both are nested — a composite owns its children as inline
 * objects, so deleting a template deletes its children for free.
 */
export interface Design {
  version: number
  root: CompositeDef
  library: Record<string, CompositeDef>
}

/** The id of the `index`-th input terminal (`in:0`, `in:1`, …). */
export const inputPortId = (index: number) => `in:${index}`
/** The id of the `index`-th output terminal (`out:0`, `out:1`, …). */
export const outputPortId = (index: number) => `out:${index}`

/** A definition's input ports (in declared order). */
export function inputPorts(ports: Port[]): Port[] {
  return ports.filter((p) => p.direction === 'input')
}

/** A definition's output ports (in declared order). */
export function outputPorts(ports: Port[]): Port[] {
  return ports.filter((p) => p.direction === 'output')
}

/**
 * Produce a fresh, unused port id of the given direction. Used by the ports editor
 * so that added ports never collide with existing ids (which may have gaps after
 * removals).
 */
export function nextPortId(ports: Port[], direction: PortDirection): string {
  const prefix = direction === 'input' ? 'in' : 'out'
  const used = ports
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

/** Whether any other library entry references `defId` as an instance (i.e. it is embedded). */
function isEmbeddedInLibrary(design: Design, defId: string): boolean {
  for (const def of Object.values(design.library)) {
    if (def.id === defId) continue
    if (def.instances.some((i) => i.def.kind === 'composite' && i.def.id === defId)) return true
  }
  return false
}

/**
 * True for a reusable origin template: a composite in the library that is not an
 * embedded copy of another template (not referenced as an instance by any other
 * library entry). These are the components listed in the library panel.
 */
export function isTemplateDef(design: Design, def: CompositeDef): boolean {
  if (def.id === design.root.id) return false
  if (design.library[def.id] !== def) return false
  return !isEmbeddedInLibrary(design, def.id)
}

/**
 * The display names of the origin templates. Used for name-collision checks when naming
 * or renaming a template — only other templates collide; names on live copies, embedded
 * copies, and the root are ignored (names are display-only).
 */
export function templateNames(design: Design): Set<string> {
  const names = new Set<string>()
  for (const def of Object.values(design.library)) {
    if (isTemplateDef(design, def)) names.add(def.name)
  }
  return names
}

/** The category shown for a template with no explicit `category` assigned. */
export const UNCATEGORIZED = 'Uncategorized'

/** A template's library category, defaulting to `UNCATEGORIZED` when unset or blank. */
export function templateCategory(def: CompositeDef): string {
  return def.category?.trim() || UNCATEGORIZED
}
