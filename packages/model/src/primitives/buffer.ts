import type { Port, PrimitiveKind, Signal } from '../types'
import { inputPortId, outputPortId } from '../types'
import { Gate, fillAndStroke, gateBounds } from './gate'
import type { DrawOptions } from './primitive'
import type { VectorContext } from './vector'

/** A buffer: passes its single input through to its output unchanged. */
export class Buffer extends Gate {
  readonly kind: PrimitiveKind = 'buffer'
  readonly label: string = 'BUFFER'
  readonly glyph: string = '▷'
  readonly fixedInputs = true
  readonly fixedOutputs = true

  defaultPorts(): Port[] {
    return [
      { id: inputPortId(0), name: 'A', direction: 'input' },
      { id: outputPortId(0), name: 'Y', direction: 'output' },
    ]
  }

  bodySize(): { w: number; h: number } {
    return { w: 28.8, h: 26.4 }
  }

  transfer(inputs: Signal[][]): Signal[][] {
    return [inputs[0]]
  }

  draw(ctx: VectorContext, opts: DrawOptions): void {
    const { l, r, t, b, cy } = gateBounds(opts)
    // Triangle with its apex at the right edge (the inversion bubble, if any, is
    // drawn by the renderer from the port's `inverted` flag).
    ctx.beginPath()
    ctx.moveTo(l, t)
    ctx.lineTo(r, cy)
    ctx.lineTo(l, b)
    ctx.closePath()
    fillAndStroke(ctx, opts.palette)
  }
}
