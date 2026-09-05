import type { Port } from '../types'
import { arrayPorts, ArrayPrimitive } from './array'
import type { PropertySpec } from './primitive'

/** An array of independent toggle switches (a multi-lane source). */
export class SwitchArray extends ArrayPrimitive {
  readonly kind = 'switch-array' as const
  readonly label = 'SWITCHES'
  readonly glyph = '⏻'
  readonly fixedInputs = true
  readonly fixedOutputs = false

  defaultPorts(): Port[] {
    return arrayPorts('output', 'bus', 1)
  }

  properties(): PropertySpec[] {
    return [
      ...super.properties(),
      { name: 'initialValue', label: 'Initial value', type: 'boolean', default: false },
      { name: 'valueFormat', label: 'Value format', type: 'select', default: 'HEX', options: ['HEX', 'DEC', 'SIGNED DEC'] },
      { name: 'order', label: 'Order', type: 'select', default: 'asc', options: ['asc', 'desc'] },
    ]
  }
}
