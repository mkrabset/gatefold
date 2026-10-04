import type { Port } from '../types'
import { arrayPorts, ArrayPrimitive } from './array'
import type { PropertySpec } from './primitive'

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

  properties(): PropertySpec[] {
    return [
      ...super.properties(),
      { name: 'valueFormat', label: 'Value format', type: 'select', default: 'HEX', options: ['HEX', 'DEC', 'SIGNED DEC', 'BINARY'] },
      { name: 'order', label: 'Order', type: 'select', default: 'asc', options: ['asc', 'desc'] },
      {
        name: 'compact',
        label: 'Compact',
        type: 'boolean',
        default: false,
        tooltip: 'Render as a single box showing the value instead of individual LEDs.',
      },
    ]
  }
}
