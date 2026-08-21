import type { Port, Signal } from '../types'
import { Gate, gateBounds } from './gate'
import { arrayPorts } from './array'
import type { DrawOptions, PropertySpec } from './primitive'
import type { VectorContext } from './vector'

/** An array of LEDs (a multi-lane sink). */
export class LedArray extends Gate {
  readonly kind = 'led-array' as const
  readonly label = 'LED-ARRAY'
  readonly glyph = '◉'
  readonly fixedInputs = false
  readonly fixedOutputs = true

  defaultPorts(): Port[] {
    return arrayPorts('input', 'wire', 4)
  }

  nextInputName(): string | null {
    return null
  }

  properties(): PropertySpec[] {
    return [
      { name: 'terminalType', label: 'Terminal type', type: 'select', default: 'wire', options: ['wire', 'bus'] },
      { name: 'size', label: 'Size', type: 'number', default: 4, min: 1, max: 32 },
    ]
  }

  bodySize(): { w: number; h: number } {
    return { w: 56, h: 40 }
  }

  transfer(): Signal[][] {
    // Sink: consumed by the simulator display.
    return []
  }

  deriveWidth(port: Port, _siblings: ReadonlyMap<string, number>): number | null {
    // The BUS input adopts the connected width (neutral); WIRE inputs are width 1.
    return port.name === 'BUS' ? null : 1
  }

  draw(ctx: VectorContext, opts: DrawOptions): void {
    // Empty-box fallback; the app renderer draws the actual array body.
    const { l, t } = gateBounds(opts)
    ctx.beginPath()
    ctx.roundRect(l, t, opts.w, opts.h, 6)
    ctx.stroke(opts.palette.gateStroke, 1.5)
  }
}
