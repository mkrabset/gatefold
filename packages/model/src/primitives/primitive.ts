import type { Port, PrimitiveKind, Signal } from '../types'
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
  /** Hovered-terminal marker highlight. */
  pinHighlight: string
  selection: string
  text: string
  /** Canvas background while editing a composite template. */
  templateBg: string
  /** Canvas background while in simulation mode. */
  simBg: string
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
  /** Radius (screen px) of the pin with the given port id, so shapes can size their bus neck. */
  pinRadius?: (portId: string) => number
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
  type: 'number' | 'string' | 'boolean' | 'select'
  default: number | string | boolean
  /** Display unit, e.g. `ms`. */
  unit?: string
  min?: number
  max?: number
  step?: number
  /** Choices for type `'select'`. */
  options?: string[]
}

/**
 * The behaviour of a built-in component. One class per primitive kind; the kind is the
 * serialized discriminant, while instances of these classes supply all per-kind
 * behaviour (ports, arity, naming, bus width, rendering, and combinational logic).
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
  /** True for stateful (edge-triggered) primitives, evaluated by the engine's sequential
   *  path rather than the combinational `transfer`. */
  isSequential(): boolean
  /** The clock input's port id for a sequential primitive, or null. */
  clockPortId?(): string | null
  /** The asynchronous reset input's port id for a sequential primitive, or null. */
  resetPortId?(): string | null
  /** For a sequential primitive, the output whose value is the complement of the
   *  register state, applied internally (no inversion bubble), or null. */
  complementPortId?(): string | null
  /** True when this primitive's terminal names should be drawn next to its pins
   *  (terminals with distinct purposes, e.g. the DFF's D/CLK/RST). */
  showTerminalNames?(): boolean
  /** Which port group this is (only meaningful when `isPortGroup()`). */
  portGroupDirection(): 'input' | 'output' | null
  /** Intrinsic bus width of `port` given the full port list (`null` = neutral/adopt).
   *  `props` is the instance's property record, for width driven by a property. */
  intrinsicWidth(ports: Port[], port: Port, props?: Record<string, unknown>): number | null

  /** Relation-based width: given determined sibling widths (portId → width), return
   *  this pin's width or null (undetermined). May return a non-integer to flag an
   *  invalid configuration (the solver reports it). Only consulted for unconnected pins. */
  deriveWidth?(port: Port, siblings: ReadonlyMap<string, number>): number | null
  /** Validation error for a resolved pin width, or null when valid. */
  widthError?(port: Port, width: number): string | null
  /** Hover hint shown when this pin's width is undetermined, or null. */
  undeterminedHint?(port: Port): string | null

  /** Body dimensions in world units. */
  bodySize(): { w: number; h: number }
  /** Draw the component body (screen space). */
  draw(ctx: VectorContext, opts: DrawOptions): void

  /**
   * Combinational behaviour: given each input port's bit-vector (ordered, after
   * input-terminal inversion is applied), return each output port's bit-vector (before
   * output-terminal inversion is applied). Sources (no inputs) and sinks (no outputs)
   * are driven/consumed by the simulator and return `[]`.
   */
  transfer(inputs: Signal[][]): Signal[][]

  /** Custom properties declared by this primitive (schema + defaults). */
  properties(): PropertySpec[]
}
