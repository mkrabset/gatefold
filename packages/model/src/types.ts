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

/** The direction a floating input terminal is weakly driven: high (`up`) or low (`down`). */
export type PullDirection = 'up' | 'down'

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
  /** A weak drive applied while the terminal is floating: pull-up (`1`) or pull-down (`0`).
   *  Only meaningful on input terminals; has no effect once the port is connected. */
  pull?: PullDirection
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
  | 'compare'
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
