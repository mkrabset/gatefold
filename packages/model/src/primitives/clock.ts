import type { Port } from '../types'
import { outputPortId } from '../types'
import { Gate } from './gate'
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

  properties(): PropertySpec[] {
    return [{ name: 'period', label: 'Period', type: 'number', default: 1000, unit: 'ms', min: 1 }]
  }

  draw(ctx: VectorContext, opts: DrawOptions): void {
    const { x: cx, y: cy, w, h, palette } = opts
    const l = cx - w / 2
    const r = cx + w / 2
    const t = cy - h / 2
    ctx.beginPath()
    ctx.roundRect(l, t, w, h, 6)
    ctx.fill(palette.gateFill)
    ctx.stroke(palette.gateStroke, 1.5)
    // Sine-wave glyph.
    ctx.beginPath()
    for (let x = l + 8; x <= r - 8; x += 1) {
      const y = cy + Math.sin(((x - (l + 8)) / (r - l - 16)) * Math.PI * 2) * 8
      if (x === l + 8) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke(palette.pin, 1.5)
  }
}
