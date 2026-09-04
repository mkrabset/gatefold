import type { ComponentDef, Design, Port, PortDirection, PrimitiveKind, PropertyValue } from '../types'
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
export type { SevenSegMode } from './seven-seg'
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

/** The behaviour objects for the placeable library primitives. */
export function libraryPrimitives(): Primitive[] {
  return LIBRARY_KINDS.map((k) => PRIMITIVES[k])
}

/** Fold a primitive's property schema into a `{ name: default }` record. */
export function defaultPropsOf(kind: PrimitiveKind): Record<string, PropertyValue> {
  return Object.fromEntries(PRIMITIVES[kind].properties().map((p) => [p.name, p.default]))
}

/** Build the serializable `ComponentDef` for a primitive kind. */
export function primitiveDef(kind: PrimitiveKind): ComponentDef {
  const p = PRIMITIVES[kind]
  return { id: kind, name: p.label, kind: 'primitive', primitive: kind, ports: p.defaultPorts() }
}

export function inputPortDef(): ComponentDef {
  return primitiveDef('input-port')
}

export function outputPortDef(): ComponentDef {
  return primitiveDef('output-port')
}

/**
 * Return a design whose built-in primitive defs are ensured: the canonical primitive
 * defs (library primitives + the internal port groups) are added/overwritten so a
 * design loaded from an older file still has every current built-in available.
 */
export function withBuiltinPrimitives(design: Design): Design {
  const defs = { ...design.defs }
  for (const kind of LIBRARY_KINDS) {
    defs[kind] = primitiveDef(kind)
  }
  defs['input-port'] = inputPortDef()
  defs['output-port'] = outputPortDef()
  return { ...design, defs }
}

/** True for the internal input-port/output-port primitive defs. */
export function isPortGroupDef(def: ComponentDef): boolean {
  return def.kind === 'primitive' && PRIMITIVES[def.primitive].isPortGroup()
}

/** The port group direction of `def`, or null when it is not a port group. */
export function portGroupDirection(def: ComponentDef): 'input' | 'output' | null {
  if (def.kind !== 'primitive' || !PRIMITIVES[def.primitive].isPortGroup()) return null
  return PRIMITIVES[def.primitive].portGroupDirection()
}

/** Whether the arity of `def` in the given direction is fixed. */
export function isArityFixed(def: ComponentDef, direction: PortDirection): boolean {
  if (def.kind === 'composite') return false
  const p = PRIMITIVES[def.primitive]
  return direction === 'input' ? p.fixedInputs : p.fixedOutputs
}

/** Whether the terminals of `def` can be renamed by the user. */
export function allowRenameTerminals(def: ComponentDef): boolean {
  if (def.kind === 'composite') return true
  return PRIMITIVES[def.primitive].allowRenameTerminals
}

/** Whether the terminals of `def` may be inverted (the negation bubble) by the user. */
export function allowInversion(def: ComponentDef): boolean {
  if (def.kind === 'composite') return true
  return PRIMITIVES[def.primitive].allowInversion
}

/** The suggested name for a newly-added input terminal of a primitive, or null. */
export function nextPrimitiveInputName(def: ComponentDef): string | null {
  if (def.kind !== 'primitive') return null
  return PRIMITIVES[def.primitive].nextInputName(def.ports)
}

/** The intrinsic width (number of wires) of a terminal (fan-in/fan-out bus = arity). */
export function portWidth(def: ComponentDef, port: Port): number {
  if (def.kind !== 'primitive') return 1
  return PRIMITIVES[def.primitive].intrinsicWidth(def.ports, port) ?? 1
}

/** Whether a definition can be "entered" for editing. */
export function isNavigableDef(def: ComponentDef): boolean {
  if (def.kind === 'composite') return true
  return PRIMITIVES[def.primitive].isNavigable()
}
