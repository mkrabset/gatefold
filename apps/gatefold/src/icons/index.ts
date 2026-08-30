import type { PrimitiveKind } from '@gatefold/model'
import andGate from './and-gate.png'
import orGate from './or-gate.png'
import xorGate from './xor-gate.png'
import notGate from './not-gate.png'
import buffer from './buffer.png'
import clock from './clock.png'
import fanIn from './fan-in.png'
import fanOut from './fan-out.png'
import busSplit from './bus-split.png'
import busMerge from './bus-merge.png'
import bus from './bus.png'
import sevenSeg from './7-seg.png'
import switches from './switches.png'
import leds from './leds.png'
import dff from './dff.png'
import joinPoint from './join-point.png'

/** PNG icon per primitive kind (port groups are internal and have no icon). */
export const PRIMITIVE_ICONS: Record<PrimitiveKind, string | undefined> = {
  and: andGate,
  or: orGate,
  xor: xorGate,
  not: notGate,
  buffer,
  clock,
  'fan-in': fanIn,
  'fan-out': fanOut,
  'bus-split': busSplit,
  'bus-merge': busMerge,
  bus,
  'seven-seg': sevenSeg,
  'switch-array': switches,
  'led-array': leds,
  dff,
  'join-point': joinPoint,
  'input-port': undefined,
  'output-port': undefined,
}
