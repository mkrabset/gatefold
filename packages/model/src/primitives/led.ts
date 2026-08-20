import type { Port, Signal } from '../types'
import { inputPortId } from '../types'
import { Gate, gateBounds } from './gate'
import type { DrawOptions } from './primitive'
import type { VectorContext } from './vector'

/** A lamp that lights when its single input is HI. Sink: one input, no outputs. */
export class Led extends Gate {
  readonly kind = 'led' as const
  readonly label = 'LED'
  readonly glyph = '◉'
  readonly fixedInputs = true
  readonly fixedOutputs = true

  defaultPorts(): Port[] {
    return [{ id: inputPortId(0), name: 'A', direction: 'input' }]
  }

  nextInputName(): string | null {
    return null
  }

  bodySize(): { w: number; h: number } {
    return { w: 36, h: 40 }
  }

  transfer(): Signal[][] {
    // Sink: consumed by the simulator display, not propagated.
    return []
  }

  draw(ctx: VectorContext, opts: DrawOptions): void {
    const { cx, cy } = gateBounds(opts)
    const { palette } = opts
    ctx.beginPath()
    ctx.arc(cx + 3, cy, 10, 0, Math.PI * 2)
    ctx.fill(palette.gateFill)
    ctx.stroke(palette.gateStroke, 1.5)
  }
}
