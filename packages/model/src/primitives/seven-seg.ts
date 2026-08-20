import type { Port, Signal } from '../types'
import { inputPortId } from '../types'
import { Gate, gateBounds } from './gate'
import type { DrawOptions } from './primitive'
import type { VectorContext } from './vector'

/**
 * A 7-segment numeric display: four binary inputs (A..D, A = least significant) and no
 * outputs. The designer draws a dim "8." skeleton; the simulator lights the segments.
 */
export class SevenSeg extends Gate {
  readonly kind = 'seven-seg' as const
  readonly label = '7-SEG'
  readonly glyph = '8'
  readonly fixedInputs = true
  readonly fixedOutputs = true

  defaultPorts(): Port[] {
    return [
      { id: inputPortId(0), name: 'A', direction: 'input' },
      { id: inputPortId(1), name: 'B', direction: 'input' },
      { id: inputPortId(2), name: 'C', direction: 'input' },
      { id: inputPortId(3), name: 'D', direction: 'input' },
    ]
  }

  nextInputName(): string | null {
    return null
  }

  bodySize(): { w: number; h: number } {
    return { w: 40, h: 64 }
  }

  transfer(): Signal[][] {
    // Sink: consumed by the simulator display, not propagated.
    return []
  }

  draw(ctx: VectorContext, opts: DrawOptions): void {
    const { l, r, t, b } = gateBounds(opts)
    const { palette } = opts
    const inset = 8
    const left = l + inset
    const right = r - inset
    const top = t + inset
    const bottom = b - inset
    const mid = (top + bottom) / 2
    const seg = (x1: number, y1: number, x2: number, y2: number) => {
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke(palette.gateStroke, 4)
    }
    seg(left + 3, top, right - 3, top)
    seg(right, top + 3, right, mid - 3)
    seg(right, mid + 3, right, bottom - 3)
    seg(left + 3, bottom, right - 3, bottom)
    seg(left, mid + 3, left, bottom - 3)
    seg(left, top + 3, left, mid - 3)
    seg(left + 3, mid, right - 3, mid)
  }
}
