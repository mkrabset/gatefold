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

/** 7-segment patterns for nibble values 0–15, ordered a b c d e f g. */
const SEGMENT_PATTERNS: number[][] = [
  [1, 1, 1, 1, 1, 1, 0], // 0
  [0, 1, 1, 0, 0, 0, 0], // 1
  [1, 1, 0, 1, 1, 0, 1], // 2
  [1, 1, 1, 1, 0, 0, 1], // 3
  [0, 1, 1, 0, 0, 1, 1], // 4
  [1, 0, 1, 1, 0, 1, 1], // 5
  [1, 0, 1, 1, 1, 1, 1], // 6
  [1, 1, 1, 0, 0, 0, 0], // 7
  [1, 1, 1, 1, 1, 1, 1], // 8
  [1, 1, 1, 1, 0, 1, 1], // 9
  [1, 1, 1, 0, 1, 1, 1], // A
  [0, 0, 1, 1, 1, 1, 1], // b
  [1, 0, 0, 1, 1, 1, 0], // C
  [0, 1, 1, 1, 1, 0, 1], // d
  [1, 0, 0, 1, 1, 1, 1], // E
  [1, 0, 0, 0, 1, 1, 1], // F
]

/** The segment mask (a..g) for a 4-bit nibble, or undefined when any bit is unknown. */
export function sevenSegDigit(bits: Signal[]): number[] | undefined {
  if (bits.length !== 4 || bits.some((b) => b !== 0 && b !== 1)) return undefined
  const value = (bits[0] as number) + 2 * (bits[1] as number) + 4 * (bits[2] as number) + 8 * (bits[3] as number)
  return SEGMENT_PATTERNS[value]
}

/** Display modes for a 7-seg: hexadecimal, unsigned decimal, or two's-complement decimal. */
export type SevenSegMode = 'HEX' | 'DEC' | 'SIGNED DEC'

/** Segment mask for a minus sign (segment `g` only). */
const SIGN_MASK = [0, 0, 0, 0, 0, 0, 1]

/** Decimal digit count of `2 ** pow2` (never an exact power of ten for pow2 ≤ 64). */
function pow2Digits(pow2: number): number {
  return Math.floor(pow2 * Math.log10(2)) + 1
}

/** Number of display slots (incl. a sign slot for SIGNED DEC) for a bus width. */
export function sevenSegPositionCount(width: number, mode: SevenSegMode): number {
  if (mode === 'DEC') return pow2Digits(width)
  if (mode === 'SIGNED DEC') return 1 + pow2Digits(width - 1)
  return Math.max(1, Math.floor(width / 4))
}

/** Segment masks per display slot (left-to-right), or null for a blank slot. */
export function sevenSegDigits(bits: Signal[], mode: SevenSegMode): (number[] | null)[] {
  const positions = sevenSegPositionCount(bits.length, mode)

  if (mode !== 'DEC' && mode !== 'SIGNED DEC') {
    // HEX: one nibble per slot, each blanked independently when its bits are unknown.
    const masks: (number[] | null)[] = []
    for (let d = 0; d < positions; d++) {
      const nibble = positions - 1 - d
      const base = nibble * 4
      masks.push(sevenSegDigit([bits[base], bits[base + 1], bits[base + 2], bits[base + 3]]) ?? null)
    }
    return masks
  }

  // DEC / SIGNED DEC: any unknown bit blanks the whole number.
  if (bits.some((b) => b !== 0 && b !== 1)) return Array.from({ length: positions }, () => null)

  const width = bits.length
  let u = 0n
  for (let i = width - 1; i >= 0; i--) u = (u << 1n) | BigInt(bits[i] as number)

  const signed = mode === 'SIGNED DEC'
  const negative = signed && bits[width - 1] === 1
  let magnitude = negative ? (1n << BigInt(width)) - u : u

  const magSlots = signed ? positions - 1 : positions
  const digits: bigint[] = []
  for (let i = 0; i < magSlots; i++) {
    digits.push(magnitude % 10n)
    magnitude /= 10n
  }
  digits.reverse()

  // Blank leading zero slots (keep at least the least-significant digit).
  let firstNonZero = -1
  for (let i = 0; i < digits.length; i++) {
    if (digits[i] !== 0n) {
      firstNonZero = i
      break
    }
  }

  const masks: (number[] | null)[] = []
  if (signed) masks.push(negative ? SIGN_MASK : null)
  for (let i = 0; i < digits.length; i++) {
    if (firstNonZero === -1) {
      masks.push(i === digits.length - 1 ? SEGMENT_PATTERNS[0] : null)
    } else if (i < firstNonZero) {
      masks.push(null)
    } else {
      masks.push(SEGMENT_PATTERNS[Number(digits[i])])
    }
  }
  return masks
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
      { name: 'mode', label: 'Mode', type: 'select', default: 'HEX', options: ['HEX', 'DEC', 'SIGNED DEC'] },
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
