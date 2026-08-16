import type { Port } from '../types'
import { inputPortId, outputPortId } from '../types'
import { Gate } from './gate'
import type { DrawOptions } from './primitive'
import type { VectorContext } from './vector'

export class XorGate extends Gate {
  readonly kind = 'xor' as const
  readonly label = 'XOR'
  readonly glyph = '=1'

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
    const r = cx + w / 2
    const t = cy - h / 2
    const b = cy + h / 2
    ctx.beginPath()
    ctx.moveTo(l, t)
    ctx.quadraticCurveTo(l + w * 0.32, cy, l, b)
    ctx.quadraticCurveTo(cx + w * 0.15, b, r, cy)
    ctx.quadraticCurveTo(cx + w * 0.15, t, l, t)
    ctx.closePath()
    ctx.moveTo(l - 7, t)
    ctx.quadraticCurveTo(l + w * 0.16, cy, l - 7, b)
    ctx.fill(palette.gateFill)
    ctx.stroke(palette.gateStroke, 1.5)
  }
}
