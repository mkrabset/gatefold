import type { Port, Signal } from '../types'
import { outputPortId } from '../types'
import { Gate, gateBounds } from './gate'
import type { DrawOptions } from './primitive'
import type { VectorContext } from './vector'

/** A user-toggled source: no inputs, one output. Its value is set by the simulator UI. */
export class Switch extends Gate {
  readonly kind = 'switch' as const
  readonly label = 'SWITCH'
  readonly glyph = '⏻'
  readonly fixedInputs = true
  readonly fixedOutputs = true

  defaultPorts(): Port[] {
    return [{ id: outputPortId(0), name: 'Q', direction: 'output' }]
  }

  nextInputName(): string | null {
    return null
  }

  bodySize(): { w: number; h: number } {
    return { w: 44, h: 44 }
  }

  transfer(): Signal[][] {
    // Source: driven by the simulator, not by inputs.
    return []
  }

  draw(ctx: VectorContext, opts: DrawOptions): void {
    const { cx, cy } = gateBounds(opts)
    const { palette } = opts
    const r = 12
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.stroke(palette.gateStroke, 1.5)
    // Toggle lever.
    ctx.beginPath()
    ctx.moveTo(cx - r + 4, cy + r - 4)
    ctx.lineTo(cx + r - 4, cy - r + 4)
    ctx.stroke(palette.gateStroke, 1.5)
  }
}
