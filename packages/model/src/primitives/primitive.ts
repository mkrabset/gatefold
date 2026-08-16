import type { Port, PrimitiveKind } from '../types'
import type { VectorContext } from './vector'

/** Canvas color palette (plain strings — keeps the model framework-free). */
export interface Palette {
  bg: string
  grid: string
  wire: string
  gateStroke: string
  gateFill: string
  compositeFill: string
  pin: string
  pinHover: string
  portHover: string
  grabHover: string
  selection: string
  text: string
}

/** The "where/how to draw" context passed to `Primitive.draw`. All screen-space. */
export interface DrawOptions {
  /** Body center, screen space (already scaled by the viewport zoom). */
  x: number
  y: number
  /** Body dimensions, screen space (already scaled). */
  w: number
  h: number
  palette: Palette
}

/**
 * A custom property declared by a primitive: its schema and default value. Drives the
 * properties panel and, later, the simulator. The default is defined here, in the class.
 */
export interface PropertySpec {
  /** Machine key used in `Instance.props` (e.g. `period`). */
  name: string
  /** Display label (e.g. `Period`). */
  label: string
  type: 'number' | 'string' | 'boolean'
  default: number | string | boolean
  /** Display unit, e.g. `ms`. */
  unit?: string
  min?: number
  max?: number
  step?: number
}

/**
 * The behaviour of a built-in component. One class per primitive kind; the kind is the
 * serialized discriminant, while instances of these classes supply all per-kind
 * behaviour (ports, arity, naming, bus width, rendering). A future simulator will add a
 * `transfer(inputs)` method here for the component's internal behaviour, and the
 * `defaultProps()` slot below is reserved for the future custom-property system.
 */
export interface Primitive {
  readonly kind: PrimitiveKind
  readonly label: string
  readonly glyph: string
  readonly fixedInputs: boolean
  readonly fixedOutputs: boolean
  readonly allowRenameTerminals: boolean

  /** The initial port set (arity may later be edited per `fixedInputs`/`fixedOutputs`). */
  defaultPorts(): Port[]
  /** Suggested name for a newly-added input terminal, or null if none. */
  nextInputName(ports: Port[]): string | null
  /** True for the internal input-port/output-port primitives. */
  isPortGroup(): boolean
  /** True when the def can be entered for editing. */
  isNavigable(): boolean
  /** Which port group this is (only meaningful when `isPortGroup()`). */
  portGroupDirection(): 'input' | 'output' | null
  /** Intrinsic bus width of `port` given the full port list (1 for single wires). */
  intrinsicWidth(ports: Port[], port: Port): number

  /** Relation-based width: given determined sibling widths (portId → width), return
   *  this pin's width or null (undetermined). May return a non-integer to flag an
   *  invalid configuration (the solver reports it). Only consulted for unconnected pins. */
  deriveWidth?(port: Port, siblings: ReadonlyMap<string, number>): number | null
  /** Hover hint shown when this pin's width is undetermined, or null. */
  undeterminedHint?(port: Port): string | null

  /** Body dimensions in world units. */
  bodySize(): { w: number; h: number }
  /** Draw the component body (screen space). */
  draw(ctx: VectorContext, opts: DrawOptions): void

  /** Custom properties declared by this primitive (schema + defaults). */
  properties(): PropertySpec[]
}
