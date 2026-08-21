import type { Port, Signal } from '../types'
import { inputPortId } from '../types'
import { Gate, gateBounds } from './gate'
import type { DrawOptions, PropertySpec } from './primitive'
import type { VectorContext } from './vector'

/**
 * The seven segment endpoints (a..g) for a display body, in screen space. Order:
 * a=top, b=top-right, c=bottom-right, d=bottom, e=bottom-left, f=top-left, g=middle.
 */
export function sevenSegGeometry(opts: DrawOptions): [number, number, number, number][] {
  const { l, r, t, b } = gateBounds(opts)
  const h = b - t
  // Inset and corner gap scale with the box so the glyph scales with zoom.
  const inset = h * 0.125
  const corner = inset * 0.375
  const left = l + inset
  const right = r - inset
  const top = t + inset
  const bottom = b - inset
  const mid = (top + bottom) / 2
  return [
    [left + corner, top, right - corner, top],
    [right, top + corner, right, mid - corner],
    [right, mid + corner, right, bottom - corner],
    [left + corner, bottom, right - corner, bottom],
    [left, mid + corner, left, bottom - corner],
    [left, top + corner, left, mid - corner],
    [left + corner, mid, right - corner, mid],
  ]
}

/**
 * A multi-digit 7-segment display: a single neutral bus input (width divisible by 4,
 * ≤ 64) renders one digit per 4-bit nibble. `order` controls which end of the bus is
 * the least-significant bit. The renderer draws the digits; this class only declares
 * the terminal, the width constraint, and the skeleton geometry.
 */
export class SevenSeg extends Gate {
  readonly kind = 'seven-seg' as const
  readonly label = '7-SEG'
  readonly glyph = '8'
  readonly fixedInputs = true
  readonly fixedOutputs = true

  defaultPorts(): Port[] {
    return [{ id: inputPortId(0), name: 'BUS', direction: 'input' }]
  }

  nextInputName(): string | null {
    return null
  }

  properties(): PropertySpec[] {
    return [
      { name: 'order', label: 'Order', type: 'select', default: 'asc', options: ['asc', 'desc'] },
    ]
  }

  intrinsicWidth(): null {
    // Neutral: adopts the width of the connected bus source.
    return null
  }

  widthError(_port: Port, width: number): string | null {
    if (width % 4 !== 0) return '7-seg width must be a multiple of 4'
    if (width > 64) return '7-seg width must be at most 64 lanes'
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
