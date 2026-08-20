import type { Port, Signal } from '../types'
import { outputPortId } from '../types'
import { Gate, fillAndStroke, gateBounds } from './gate'
import type { DrawOptions, PropertySpec } from './primitive'
import type { VectorContext } from './vector'

export class Clock extends Gate {
  readonly kind = 'clock' as const
  readonly label = 'CLOCK'
  readonly glyph = '∿'
  readonly fixedInputs = true
  readonly fixedOutputs = true

  defaultPorts(): Port[] {
    return [{ id: outputPortId(0), name: 'CLK', direction: 'output' }]
  }

  nextInputName(): string | null {
    return null
  }

  bodySize(): { w: number; h: number } {
    return { w: 46, h: 46 }
  }

  transfer(): Signal[][] {
    // Source: driven by the simulator (square wave from `period`), not by inputs.
    return []
  }

  properties(): PropertySpec[] {
    return [{ name: 'period', label: 'Period', type: 'number', default: 10_000, unit: 'ps', min: 1 }]
  }

  draw(ctx: VectorContext, opts: DrawOptions): void {
    const { l, r, t, cy } = gateBounds(opts)
    const { w, h } = opts
    ctx.beginPath()
    ctx.roundRect(l, t, w, h, 6)
    fillAndStroke(ctx, opts.palette)
    // Sine-wave glyph.
    ctx.beginPath()
    for (let x = l + 8; x <= r - 8; x += 1) {
      const y = cy + Math.sin(((x - (l + 8)) / (r - l - 16)) * Math.PI * 2) * 8
      if (x === l + 8) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke(opts.palette.pin, 1.5)
  }
}
