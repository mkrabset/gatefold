import type { Port, PrimitiveKind, PropertyValue, Signal } from '../types'
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
  /** Dashed delete-cut line (Alt+drag). */
  cutDelete: string
  /** Saturated orange used for proximity auto-connect (magnetic wiring) previews. */
  autoConnect: string
  text: string
  /** Canvas background while editing a composite template. */
  templateBg: string
  /** Canvas background while in simulation mode. */
  simBg: string
  /** 7-seg display body fill color. */
  sevenSegFill: string
  /** 7-seg display body border color. */
  sevenSegStroke: string
  /** 7-seg unlit segment color (the dim skeleton). */
  sevenSegOff: string
  /** 7-seg lit segment color. */
  sevenSegOn: string
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
  /** The instance's property record, for primitives that render property-dependent
   *  visuals (e.g. the BUS primitive's `flip` twist). */
  props?: Record<string, PropertyValue>
}

/**
 * A custom property declared by a primitive: its schema and default value. Drives the
 * properties panel and, later, the simulator. The default is defined here, in the class.
 * The `type` discriminates which fields are present (e.g. `select` requires `options`).
 */
export type PropertySpec =
  | { name: string; label: string; type: 'number'; default: number; unit?: string; min?: number; max?: number; step?: number; tooltip?: string }
  | { name: string; label: string; type: 'string'; default: string; tooltip?: string }
  | { name: string; label: string; type: 'boolean'; default: boolean; tooltip?: string }
  | { name: string; label: string; type: 'select'; default: string; options: string[]; tooltip?: string }

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
  /** Whether the user may toggle terminal inversion (the negation bubble) on this primitive. */
  readonly allowInversion: boolean

  /** The initial port set (arity may later be edited per `fixedInputs`/`fixedOutputs`). */
  defaultPorts(): Port[]
  /** Suggested name for a newly-added input terminal, or null if none. */
  nextInputName(ports: Port[]): string | null
  /** True for the internal input-port/output-port primitives. */
  isPortGroup(): boolean
  /** True when the def can be entered for editing. */
  isNavigable(): boolean
  /** True for stateful (edge-triggered) primitives, evaluated by the engine's sequential
   *  path rather than the combinational `transfer`. `props` is the instance's property
   *  record, for primitives whose sequential-ness depends on a per-instance value
   *  (e.g. a ROM's `access` mode). */
  isSequential(props?: Record<string, PropertyValue>): boolean
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
  /** True when all of this primitive's terminals coincide at the body center (e.g. the
   *  single-wire join-point dot), so pin placement/hit-testing/rendering special-case it. */
  coincidentTerminals?(): boolean
  /** Which port group this is (only meaningful when `isPortGroup()`). */
  portGroupDirection(): 'input' | 'output' | null
  /** Intrinsic bus width of `port` given the full port list (`null` = neutral/adopt).
   *  `props` is the instance's property record, for width driven by a property. */
  intrinsicWidth(ports: Port[], port: Port, props?: Record<string, PropertyValue>): number | null

  /** Relation-based width: given determined sibling widths (portId → width), return
   *  this pin's width or null (undetermined). May return a non-integer to flag an
   *  invalid configuration (the solver reports it). Only consulted for unconnected pins.
   *  `props` is the instance's property record, for relations that depend on a
   *  per-instance value (e.g. a bus-split/bus-merge `firstLanes`). `ports` is the
   *  instance's full port list, for relations that depend on arity (e.g. a fan-in's
   *  output width is the sum of its input widths). */
  deriveWidth?(port: Port, siblings: ReadonlyMap<string, number>, props?: Record<string, PropertyValue>, ports?: Port[]): number | null
  /** A per-pin width seeded *in addition to* a `deriveWidth` relation, when a property
   *  pins a terminal to a specific width (e.g. a register/counter's `width` in BUS mode).
   *  Seeded as a hard value, so a mismatched connection conflicts; returns null to leave
   *  the pin to its relation/neutral adoption. Only relation primitives that can be
   *  pinned by a property need implement this. */
  pinnedWidth?(port: Port, props?: Record<string, PropertyValue>): number | null
  /** Validation error for a resolved pin width, or null when valid. `siblings` is the
   *  resolved widths of the instance's other pins, for relations that must hold across
   *  all of them (e.g. a fan-out's input width must equal the sum of its outputs). */
  widthError?(port: Port, width: number, siblings?: ReadonlyMap<string, number>): string | null
  /** A soft fallback width for `port` when the width solver leaves it undetermined
   *  (applied *after* the main fixpoint, so a bus-connected lane keeps its real width).
   *  Returns null when there is no sensible default (e.g. a fan-out's derived bus input). */
  defaultWidth?(port: Port): number | null
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
   * are driven/consumed by the simulator and return `[]`. `props` is the instance's
   * property record, for primitives whose behaviour depends on per-instance values
   * (e.g. the ROM's stored memory). `outputWidths` is each output net's resolved width
   * (in output order), for primitives that reshape a bus into sub-buses (e.g. a
   * fan-out splitting its input into per-lane chunks).
   */
  transfer(inputs: Signal[][], props?: Record<string, PropertyValue>, outputWidths?: number[]): Signal[][]

  /** Custom properties declared by this primitive (schema + defaults). */
  properties(): PropertySpec[]
}
