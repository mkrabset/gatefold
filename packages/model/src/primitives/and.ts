import type { Port, Signal } from '../types'
import { Gate, fillAndStroke, gateBounds, twoInputGateBody, twoInputGatePorts } from './gate'
import { andBits } from './logic'
import type { DrawOptions } from './primitive'
import type { VectorContext } from './vector'

export class AndGate extends Gate {
  readonly kind = 'and' as const
  readonly label = 'AND'
  readonly glyph = '&'

  defaultPorts(): Port[] {
    return twoInputGatePorts()
  }

  bodySize(): { w: number; h: number } {
    return twoInputGateBody()
  }

  transfer(inputs: Signal[][]): Signal[][] {
    return [[andBits(inputs.map((v) => v[0]))]]
  }

  draw(ctx: VectorContext, opts: DrawOptions): void {
    const { l, t, b, cy } = gateBounds(opts)
    const { w, h } = opts
    ctx.beginPath()
    ctx.moveTo(l, t)
    ctx.lineTo(l, b)
    ctx.ellipse(l, cy, w, h / 2, 0, Math.PI / 2, -Math.PI / 2, true)
    ctx.closePath()
    fillAndStroke(ctx, opts.palette)
  }
}
