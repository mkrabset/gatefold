import type { Port } from '../types'
import { inputPortId, outputPortId } from '../types'
import { Gate } from './gate'
import type { DrawOptions } from './primitive'
import type { VectorContext } from './vector'

export class AndGate extends Gate {
  readonly kind = 'and' as const
  readonly label = 'AND'
  readonly glyph = '&'

  defaultPorts(): Port[] {
    return [
      { id: inputPortId(0), name: 'A', direction: 'input' },
      { id: inputPortId(1), name: 'B', direction: 'input' },
      { id: outputPortId(0), name: 'Y', direction: 'output' },
    ]
  }

  bodySize(): { w: number; h: number } {
    return { w: 64, h: 44 }
  }

  draw(ctx: VectorContext, opts: DrawOptions): void {
    const { x: cx, y: cy, w, h, palette } = opts
    const l = cx - w / 2
    const t = cy - h / 2
    const b = cy + h / 2
    ctx.beginPath()
    ctx.moveTo(l, t)
    ctx.lineTo(l, b)
    ctx.ellipse(l, cy, w, h / 2, 0, Math.PI / 2, -Math.PI / 2, true)
    ctx.closePath()
    ctx.fill(palette.gateFill)
    ctx.stroke(palette.gateStroke, 1.5)
  }
}
