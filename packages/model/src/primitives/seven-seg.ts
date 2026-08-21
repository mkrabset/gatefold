import type { Port, Signal } from '../types'
import { inputPortId } from '../types'
import { Gate, gateBounds } from './gate'
import type { DrawOptions, PropertySpec } from './primitive'
import type { VectorContext } from './vector'

/**
 * The seven segment outlines (a..g) as hexagon polygons with pointed ends, in screen
 * space. Order: a=top, b=top-right, c=bottom-right, d=bottom, e=bottom-left, f=top-left,
 * g=middle. Each polygon is a list of [x, y] points to fill.
 */
export function sevenSegGeometry(opts: DrawOptions): [number, number][][] {
  const { l, r, t, b } = gateBounds(opts)
  const h = b - t
  // All metrics scale with the box height so the glyph scales with zoom.
  const inset = h * 0.06
  const th = h * 0.055
  const corner = h * 0.0625
  const left = l + inset
  const right = r - inset
  const top = t + inset
  const bottom = b - inset
  const mid = (top + bottom) / 2

  // Horizontal hexagon with pointed left/right ends.
  const hseg = (x0: number, x1: number, y: number): [number, number][] => [
    [x0, y],
    [x0 + th, y - th],
    [x1 - th, y - th],
    [x1, y],
    [x1 - th, y + th],
    [x0 + th, y + th],
  ]
  // Vertical hexagon with pointed top/bottom ends.
  const vseg = (x: number, y0: number, y1: number): [number, number][] => [
    [x, y0],
    [x + th, y0 + th],
    [x + th, y1 - th],
    [x, y1],
    [x - th, y1 - th],
    [x - th, y0 + th],
  ]

  return [
    hseg(left + corner, right - corner, top),
    vseg(right, top + corner, mid - corner),
    vseg(right, mid + corner, bottom - corner),
    hseg(left + corner, right - corner, bottom),
    vseg(left, mid + corner, bottom - corner),
    vseg(left, top + corner, mid - corner),
    hseg(left + corner, right - corner, mid),
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
    for (const poly of sevenSegGeometry(opts)) {
      ctx.beginPath()
      ctx.moveTo(poly[0][0], poly[0][1])
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1])
      ctx.closePath()
      ctx.fill(opts.palette.compositeFill)
    }
  }
}
