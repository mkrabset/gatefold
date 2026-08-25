import type { Port } from '../types'
import { arrayPorts, ArrayPrimitive } from './array'

/** An array of LEDs (a multi-lane sink). */
export class LedArray extends ArrayPrimitive {
  readonly kind = 'led-array' as const
  readonly label = 'LEDS'
  readonly glyph = '◉'
  readonly fixedInputs = false
  readonly fixedOutputs = true

  defaultPorts(): Port[] {
    return arrayPorts('input', 'bus', 1)
  }
}
