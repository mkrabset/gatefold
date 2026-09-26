import type { PropertyValue, Signal } from './types'

/**
 * Radix for entering/displaying a bus value: hexadecimal, unsigned decimal,
 * two's-complement decimal, or binary. Shared by the 7-seg display (`mode`), the
 * switch-array (`valueFormat`), and the ROM (`valueFormat`).
 */
export type ValueFormat = 'HEX' | 'DEC' | 'SIGNED DEC' | 'BINARY'

/** Bit order of a bus: `asc` = lane 0 is the least-significant bit, `desc` = lane 0 is the most-significant. */
export type ValueOrder = 'asc' | 'desc'

/** Narrow any value to a `ValueFormat`, defaulting to HEX. */
export function toValueFormat(v: unknown): ValueFormat {
  return v === 'DEC' || v === 'SIGNED DEC' || v === 'BINARY' ? v : 'HEX'
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
    const radix = format === 'HEX' ? 16 : format === 'BINARY' ? 2 : 10
    const re = format === 'HEX' ? /^[0-9a-fA-F]+$/ : format === 'BINARY' ? /^[01]+$/ : /^[0-9]+$/
    const t = text.trim()
    if (!re.test(t)) return null
    try {
      value = radix === 16 ? BigInt(`0x${t}`) : radix === 2 ? BigInt(`0b${t}`) : BigInt(t)
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

  if (format === 'BINARY') return width > 0 ? u.toString(2).padStart(width, '0') : '0'

  const digits = Math.max(1, Math.ceil(width / 4))
  return u.toString(16).toUpperCase().padStart(digits, '0')
}

/** Map least-significant-first bits to lane order (and back): `desc` reverses the vector. */
export function applyValueOrder<T>(bits: T[], order: ValueOrder): T[] {
  return order === 'desc' ? [...bits].reverse() : [...bits]
}

/** The longest string a `width`-bit value can render as in `format` (used to size the
 *  compact switch box). For `SIGNED DEC` the most-negative value is the longest. */
export function maxSwitchValueText(width: number, format: ValueFormat): string {
  if (!Number.isInteger(width) || width < 1) return '?'
  const W = BigInt(width)
  if (format === 'HEX') return 'F'.repeat(Math.max(1, Math.ceil(width / 4)))
  if (format === 'DEC') return ((1n << W) - 1n).toString(10)
  if (format === 'BINARY') return '1'.repeat(width)
  return '-' + (1n << (W - 1n)).toString(10)
}

/**
 * Resolve a switch-array's initial lane values (`lane[0]` first) from its instance
 * props. `props.initialValue` is normally the text the user typed (parsed in
 * `valueFormat`, mapped onto lanes via `order`), but a boolean survives from legacy
 * files: `true` set every lane, `false` cleared every lane. Unparseable text resolves
 * to all-zero lanes.
 */
export function switchInitialLanes(
  props: Record<string, PropertyValue> | undefined,
  width: number,
): Signal[] {
  const raw = props?.initialValue
  if (typeof raw === 'boolean') {
    return Array.from({ length: width }, () => (raw ? 1 : 0) as Signal)
  }
  const bits = parseSwitchValue(String(raw ?? ''), valueFormatOf(props), width)
  if (!bits) return Array.from({ length: width }, () => 0 as Signal)
  return applyValueOrder(bits, valueOrderOf(props))
}

/**
 * Parse a ROM's memory contents: a whitespace/comma/newline-separated list of values in
 * `format` (one word per address, ascending from address 0), each a `dataWidth`-bit
 * unsigned value. Returns the memory as `count` vectors (LSB-first), padding missing
 * addresses with all-zero and ignoring trailing extras, or `null` when any token is
 * invalid for the format or out of range for `dataWidth`.
 */
export function parseMemoryContents(
  text: string,
  format: ValueFormat,
  dataWidth: number,
  count: number,
): Signal[][] | null {
  const w = Math.max(1, Math.floor(dataWidth))
  const n = Math.max(0, Math.floor(count))
  const zero = (): Signal[] => Array.from({ length: w }, () => 0 as Signal)
  const tokens = text.split(/[\s,;]+/).filter((t) => t.length > 0)
  const mem: Signal[][] = []
  for (const token of tokens) {
    if (mem.length >= n) break
    const bits = parseSwitchValue(token, format, w)
    if (!bits) return null
    mem.push(bits)
  }
  while (mem.length < n) mem.push(zero())
  return mem
}

/**
 * Render a ROM's memory (an array of `dataWidth`-bit vectors, LSB-first) as text in
 * `format`, one word per address, separated by newlines.
 */
export function formatMemoryContents(mem: Signal[][], format: ValueFormat): string {
  return mem.map((word) => formatSwitchValue(word, format)).join('\n')
}
