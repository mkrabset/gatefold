import type { ChildDef, Port, PortDirection, PrimitiveKind, PropertyValue } from '../types'
import type { Primitive } from './primitive'
import { AndGate } from './and'
import { OrGate } from './or'
import { XorGate } from './xor'
import { NotGate } from './not'
import { Buffer } from './buffer'
import { Clock } from './clock'
import { FanIn } from './fan-in'
import { FanOut } from './fan-out'
import { BusSplit } from './bus-split'
import { BusMerge } from './bus-merge'
import { Bus } from './bus'
import { InputPort } from './input-port'
import { OutputPort } from './output-port'
import { SevenSeg } from './seven-seg'
import { SwitchArray } from './switch-array'
import { LedArray } from './led-array'
import { Dff } from './dff'
import { JoinPoint } from './join-point'

export type { Primitive, Palette, DrawOptions, PropertySpec } from './primitive'
export type { VectorContext } from './vector'
export { sevenSegGeometry, sevenSegDigit, sevenSegPositionCount, sevenSegDigits, sevenSegModeOf } from './seven-seg'
export { arrayPorts, isArrayDef, arrayDirection } from './array'
export { CLOCK_DEFAULT_PERIOD, periodOf } from './clock'
export { invertSignal } from './logic'

const PRIMITIVES: Record<PrimitiveKind, Primitive> = {
  and: new AndGate(),
  or: new OrGate(),
  xor: new XorGate(),
  not: new NotGate(),
  buffer: new Buffer(),
  clock: new Clock(),
  'fan-in': new FanIn(),
  'fan-out': new FanOut(),
  'bus-split': new BusSplit(),
  'bus-merge': new BusMerge(),
  bus: new Bus(),
  'input-port': new InputPort(),
  'output-port': new OutputPort(),
  'seven-seg': new SevenSeg(),
  'switch-array': new SwitchArray(),
  'led-array': new LedArray(),
  dff: new Dff(),
  'join-point': new JoinPoint(),
}

/** The kinds shown in the library palette (port groups are internal only). */
export const LIBRARY_KINDS: PrimitiveKind[] = ['and', 'or', 'xor', 'not', 'buffer', 'clock', 'fan-in', 'fan-out', 'bus-split', 'bus-merge', 'bus', 'seven-seg', 'switch-array', 'led-array', 'dff', 'join-point']

/** The behaviour object for a primitive kind. */
export function primitiveOf(kind: PrimitiveKind): Primitive {
  return PRIMITIVES[kind]
}

/** True when `kind` names a registered primitive kind. */
export function isPrimitiveKind(kind: string): kind is PrimitiveKind {
  return kind in PRIMITIVES
}

/** The behaviour objects for the placeable library primitives. */
export function libraryPrimitives(): Primitive[] {
  return LIBRARY_KINDS.map((k) => PRIMITIVES[k])
}

/** The primitive kind of a child def, or null for a composite. */
export function childPrimitive(def: ChildDef): PrimitiveKind | null {
  return def.kind === 'composite' ? null : def.primitive
}

/** A child def's ports (built-ins derive theirs from the registry). */
export function childPorts(def: ChildDef): Port[] {
  if (def.kind === 'composite' || def.kind === 'fork') return def.ports
  return PRIMITIVES[def.primitive].defaultPorts()
}

/** A child def's display label (built-ins/fork use the primitive label). */
export function childLabel(def: ChildDef): string {
  if (def.kind === 'composite') return def.name
  return PRIMITIVES[def.primitive].label
}

/** A shared built-in child reference (ports derived from the registry). */
export function builtinOf(kind: PrimitiveKind): ChildDef {
  return { kind: 'builtin', primitive: kind }
}

/** An owned primitive fork carrying the registry's default ports. */
export function forkOf(kind: PrimitiveKind): ChildDef & { kind: 'fork' } {
  return { kind: 'fork', primitive: kind, ports: PRIMITIVES[kind].defaultPorts() }
}

/** Fold a primitive's property schema into a `{ name: default }` record. */
export function defaultPropsOf(kind: PrimitiveKind): Record<string, PropertyValue> {
  return Object.fromEntries(PRIMITIVES[kind].properties().map((p) => [p.name, p.default]))
}

/** True for the internal input-port/output-port built-in references. */
export function isPortGroupDef(def: ChildDef): boolean {
  const k = childPrimitive(def)
  return !!k && PRIMITIVES[k].isPortGroup()
}

/** The port group direction of `def`, or null when it is not a port group. */
export function portGroupDirection(def: ChildDef): 'input' | 'output' | null {
  const k = childPrimitive(def)
  if (!k || !PRIMITIVES[k].isPortGroup()) return null
  return PRIMITIVES[k].portGroupDirection()
}

/** Whether the arity of `def` in the given direction is fixed. */
export function isArityFixed(def: ChildDef, direction: PortDirection): boolean {
  if (def.kind === 'composite') return false
  return direction === 'input' ? PRIMITIVES[def.primitive].fixedInputs : PRIMITIVES[def.primitive].fixedOutputs
}

/** Whether the terminals of `def` can be renamed by the user. */
export function allowRenameTerminals(def: ChildDef): boolean {
  if (def.kind === 'composite') return true
  return PRIMITIVES[def.primitive].allowRenameTerminals
}

/** Whether the terminals of `def` may be inverted (the negation bubble) by the user. */
export function allowInversion(def: ChildDef): boolean {
  if (def.kind === 'composite') return true
  return PRIMITIVES[def.primitive].allowInversion
}

/** The suggested name for a newly-added input terminal of a primitive, or null. */
export function nextPrimitiveInputName(def: ChildDef): string | null {
  const k = childPrimitive(def)
  if (!k) return null
  return PRIMITIVES[k].nextInputName(childPorts(def))
}

/** The intrinsic width (number of wires) of a terminal (fan-in/fan-out bus = arity). */
export function portWidth(def: ChildDef, port: Port): number {
  const k = childPrimitive(def)
  if (!k) return 1
  return PRIMITIVES[k].intrinsicWidth(childPorts(def), port) ?? 1
}

/** Whether a definition can be "entered" for editing. */
export function isNavigableDef(def: ChildDef): boolean {
  if (def.kind === 'composite') return true
  return PRIMITIVES[def.primitive].isNavigable()
}
