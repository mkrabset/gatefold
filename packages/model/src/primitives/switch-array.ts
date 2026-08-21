import type { Port } from '../types'
import { arrayPorts, ArrayPrimitive } from './array'

/** An array of independent toggle switches (a multi-lane source). */
export class SwitchArray extends ArrayPrimitive {
  readonly kind = 'switch-array' as const
  readonly label = 'SWITCH-ARRAY'
  readonly glyph = '⏻'
  readonly fixedInputs = true
  readonly fixedOutputs = false

  defaultPorts(): Port[] {
    return arrayPorts('output', 'wire', 1)
  }
}
