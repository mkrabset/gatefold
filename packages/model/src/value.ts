import type { PropertyValue, Signal } from './types'

/**
 * Radix for entering/displaying a bus value: hexadecimal, unsigned decimal, or
 * two's-complement decimal. Shared by the 7-seg display (`mode`) and the switch-array
 * (`valueFormat`).
 */
export type ValueFormat = 'HEX' | 'DEC' | 'SIGNED DEC'

/** Bit order of a bus: `asc` = lane 0 is the least-significant bit, `desc` = lane 0 is the most-significant. */
export type ValueOrder = 'asc' | 'desc'

/** Narrow any value to a `ValueFormat`, defaulting to HEX. */
export function toValueFormat(v: unknown): ValueFormat {
  return v === 'DEC' || v === 'SIGNED DEC' ? v : 'HEX'
}

/** Resolve an instance's `valueFormat` property (absent/unknown → HEX). */
export function valueFormatOf(props: Record<string, PropertyValue> | undefined): ValueFormat {
  return toValueFormat(props?.valueFormat)
}

/** Resolve an instance's `order` property (absent/unknown → asc). */
export function valueOrderOf(props: Record<string, PropertyValue> | undefined): ValueOrder {
  return props?.order === 'desc' ? 'desc' : 'asc'
}

/**
 * Parse user-typed text into a `width`-bit vector with `bits[0]` the least-significant
 * bit, or `null` when the text is invalid for `format` or out of range for `width`.
 * `SIGNED DEC` accepts an optional `-`/`+` sign over `[-2^(width-1), 2^(width-1)-1]`;
 * negatives are encoded as two's-complement.
 */
export function parseSwitchValue(text: string, format: ValueFormat, width: number): (0 | 1)[] | null {
  if (!Number.isInteger(width) || width < 1) return null
  const W = BigInt(width)

  let value: bigint
  if (format === 'SIGNED DEC') {
    const m = /^([+-]?)([0-9]+)$/.exec(text.trim())
    if (!m) return null
    const neg = m[1] === '-'
    let mag: bigint
    try {
      mag = BigInt(m[2])
    } catch {
      return null
    }
    if (neg) {
      if (mag > 1n << (W - 1n)) return null
      value = (1n << W) - mag
    } else {
      if (mag > (1n << (W - 1n)) - 1n) return null
      value = mag
    }
  } else {
    const radix = format === 'HEX' ? 16 : 10
    const re = format === 'HEX' ? /^[0-9a-fA-F]+$/ : /^[0-9]+$/
    const t = text.trim()
    if (!re.test(t)) return null
    try {
      value = radix === 16 ? BigInt(`0x${t}`) : BigInt(t)
    } catch {
      return null
    }
    if (value > (1n << W) - 1n) return null
  }

  const bits: (0 | 1)[] = []
  for (let i = 0; i < width; i++) bits.push(((value >> BigInt(i)) & 1n) === 1n ? 1 : 0)
  return bits
}

/**
 * Format a bit vector (`bits[0]` = least-significant bit) as text in the given radix.
 * HEX is zero-padded to the number of nibbles; `SIGNED DEC` emits a leading `-` when
 * the sign bit is set.
 */
export function formatSwitchValue(bits: Signal[], format: ValueFormat): string {
  const width = bits.length
  let u = 0n
  for (let i = width - 1; i >= 0; i--) u = (u << 1n) | (bits[i] === 1 ? 1n : 0n)

  if (format === 'DEC') return u.toString(10)

  if (format === 'SIGNED DEC') {
    const negative = width > 0 && bits[width - 1] === 1
    const magnitude = negative ? (1n << BigInt(width)) - u : u
    return `${negative ? '-' : ''}${magnitude.toString(10)}`
  }

  const digits = Math.max(1, Math.ceil(width / 4))
  return u.toString(16).toUpperCase().padStart(digits, '0')
}

/** Map least-significant-first bits to lane order (and back): `desc` reverses the vector. */
export function applyValueOrder<T>(bits: T[], order: ValueOrder): T[] {
  return order === 'desc' ? [...bits].reverse() : [...bits]
}
