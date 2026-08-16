import type { Port } from '../types'
import { inputPortId, outputPortId } from '../types'
import { Gate } from './gate'
import type { DrawOptions } from './primitive'
import type { VectorContext } from './vector'

export class NotGate extends Gate {
  readonly kind = 'not' as const
  readonly label = 'NOT'
  readonly glyph = '1'
  readonly fixedInputs = true

  defaultPorts(): Port[] {
    return [
      { id: inputPortId(0), name: 'A', direction: 'input' },
      { id: outputPortId(0), name: 'Y', direction: 'output' },
    ]
  }

  bodySize(): { w: number; h: number } {
    return { w: 48, h: 44 }
  }

  draw(ctx: VectorContext, opts: DrawOptions): void {
    const { x: cx, y: cy, w, h, palette } = opts
    const l = cx - w / 2
    const r = cx + w / 2
    const t = cy - h / 2
    const b = cy + h / 2
    ctx.beginPath()
    ctx.moveTo(l, t)
    ctx.lineTo(r - 7, cy)
    ctx.lineTo(l, b)
    ctx.closePath()
    ctx.fill(palette.gateFill)
    ctx.stroke(palette.gateStroke, 1.5)
    // Inversion bubble.
    ctx.beginPath()
    ctx.arc(r - 3, cy, 4, 0, Math.PI * 2)
    ctx.fill(palette.gateFill)
    ctx.stroke(palette.gateStroke, 1.5)
  }
}
