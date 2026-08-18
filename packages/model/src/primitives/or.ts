import type { Port } from '../types'
import { Gate, fillAndStroke, gateBounds, twoInputGateBody, twoInputGatePorts } from './gate'
import type { DrawOptions } from './primitive'
import type { VectorContext } from './vector'

export class OrGate extends Gate {
  readonly kind = 'or' as const
  readonly label = 'OR'
  readonly glyph = '≥1'

  defaultPorts(): Port[] {
    return twoInputGatePorts()
  }

  bodySize(): { w: number; h: number } {
    return twoInputGateBody()
  }

  draw(ctx: VectorContext, opts: DrawOptions): void {
    const { l, r, t, b, cx, cy } = gateBounds(opts)
    const { w } = opts
    ctx.beginPath()
    ctx.moveTo(l, t)
    ctx.quadraticCurveTo(l + w * 0.32, cy, l, b)
    ctx.quadraticCurveTo(cx + w * 0.15, b, r, cy)
    ctx.quadraticCurveTo(cx + w * 0.15, t, l, t)
    ctx.closePath()
    fillAndStroke(ctx, opts.palette)
  }
}
