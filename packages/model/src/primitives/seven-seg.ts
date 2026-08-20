import type { Port, Signal } from '../types'
import { inputPortId } from '../types'
import { Gate, gateBounds } from './gate'
import type { DrawOptions } from './primitive'
import type { VectorContext } from './vector'

/**
 * The seven segment endpoints (a..g) for a display body, in screen space. Order:
 * a=top, b=top-right, c=bottom-right, d=bottom, e=bottom-left, f=top-left, g=middle.
 */
export function sevenSegGeometry(opts: DrawOptions): [number, number, number, number][] {
  const { l, r, t, b } = gateBounds(opts)
  const inset = 8
  const left = l + inset
  const right = r - inset
  const top = t + inset
  const bottom = b - inset
  const mid = (top + bottom) / 2
  return [
    [left + 3, top, right - 3, top],
    [right, top + 3, right, mid - 3],
    [right, mid + 3, right, bottom - 3],
    [left + 3, bottom, right - 3, bottom],
    [left, mid + 3, left, bottom - 3],
    [left, top + 3, left, mid - 3],
    [left + 3, mid, right - 3, mid],
  ]
}

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
    for (const [x1, y1, x2, y2] of sevenSegGeometry(opts)) {
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke(opts.palette.compositeFill, 6)
    }
  }
}
