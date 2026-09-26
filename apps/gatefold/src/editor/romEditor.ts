import type { Signal, ValueFormat } from '@gatefold/model'
import { formatSwitchValue, parseSwitchValue } from '@gatefold/model'

/**
 * Pure presentation + editing logic for the ROM contents editor. Lives in the app (not
 * the model) because it is a UI concern: fixed-width, address-prefixed line formatting
 * and per-digit overwrite semantics. Reuses the model's `formatSwitchValue` /
 * `parseSwitchValue` for word<->text conversion.
 */

/** Number of decimal digits needed for the maximum `width`-bit unsigned value. */
function decWidth(width: number): number {
  return ((1n << BigInt(Math.max(1, Math.floor(width)))) - 1n).toString(10).length
}

/** Fixed character count of an address token in the given radix. */
export function addrCharCount(format: ValueFormat, busWidth: number): number {
  const w = Math.max(1, Math.floor(busWidth))
  if (format === 'HEX') return Math.max(1, Math.ceil(w / 4))
  if (format === 'BINARY') return w
  return decWidth(w)
}

/** Fixed character count of a data word in the given radix. */
export function valueCharCount(format: ValueFormat, dataWidth: number): number {
  const w = Math.max(1, Math.floor(dataWidth))
  if (format === 'HEX') return Math.max(1, Math.ceil(w / 4))
  if (format === 'BINARY') return w
  return decWidth(w)
}

/** A word's bit-vector value as an unsigned BigInt (bits[0] = least-significant). */
function wordToBigint(bits: Signal[]): bigint {
  let u = 0n
  for (let i = bits.length - 1; i >= 0; i--) u = (u << 1n) | (bits[i] === 1 ? 1n : 0n)
  return u
}

/** Encode an unsigned BigInt as a `width`-bit vector (bits[0] = least-significant). */
function bigintToWord(value: bigint, width: number): Signal[] {
  const bits: Signal[] = []
  for (let i = 0; i < width; i++) bits.push(((value >> BigInt(i)) & 1n) === 1n ? 1 : 0)
  return bits
}

/** Format an address index as a fixed-width, zero-padded token in `format`. */
export function formatAddress(index: number, format: ValueFormat, busWidth: number): string {
  const w = Math.max(1, Math.floor(busWidth))
  if (format === 'DEC') return index.toString(10).padStart(decWidth(w), '0')
  return formatSwitchValue(bigintToWord(BigInt(index), w), format)
}

/** Format a data word as a fixed-width, zero-padded token in `format`. */
export function formatValue(word: Signal[], format: ValueFormat, dataWidth: number): string {
  const w = Math.max(1, Math.floor(dataWidth))
  if (format === 'DEC') return wordToBigint(word).toString(10).padStart(decWidth(w), '0')
  return formatSwitchValue(word, format)
}

/** Parse a fixed-width data token back into a bit vector, or null when invalid. */
export function parseValue(text: string, format: ValueFormat, dataWidth: number): Signal[] | null {
  return parseSwitchValue(text, format, Math.max(1, Math.floor(dataWidth)))
}

/**
 * Overwrite one digit of a word in place: `digitIndex` counts from the left (the most
 * significant end). HEX sets a whole 4-bit nibble, BINARY sets a single bit, and DEC
 * replaces a decimal digit and clamps the result to the data width. Invalid characters
 * leave the word unchanged.
 */
export function applyDigit(
  word: Signal[],
  format: ValueFormat,
  dataWidth: number,
  digitIndex: number,
  char: string,
): Signal[] {
  const w = Math.max(1, Math.floor(dataWidth))
  const chars = valueCharCount(format, w)
  if (digitIndex < 0 || digitIndex >= chars) return word

  if (format === 'BINARY') {
    if (char !== '0' && char !== '1') return word
    const next = word.slice()
    next[w - 1 - digitIndex] = char === '1' ? 1 : 0
    return next
  }

  if (format === 'HEX') {
    if (!/^[0-9a-fA-F]$/.test(char)) return word
    const nibble = parseInt(char, 16)
    const lowBit = (chars - 1 - digitIndex) * 4
    const next = word.slice()
    for (let i = 0; i < 4; i++) {
      const bit = lowBit + i
      if (bit < w) next[bit] = ((nibble >> i) & 1) === 1 ? 1 : 0
    }
    return next
  }

  // DEC: replace one decimal digit, then clamp to the width's unsigned range.
  if (!/^[0-9]$/.test(char)) return word
  const digits = wordToBigint(word).toString(10).padStart(chars, '0').split('')
  digits[digitIndex] = char
  let value = BigInt(digits.join(''))
  const max = (1n << BigInt(w)) - 1n
  if (value > max) value = max
  return bigintToWord(value, w)
}

/** The largest of 1/2/4/8 values that fits `availableChars` characters per line. */
export function valuesPerLineFor(availableChars: number, addrChars: number, valueChars: number): number {
  const capacity = Math.max(1, Math.floor(availableChars))
  let best = 1
  for (const n of [1, 2, 4, 8]) {
    if (addrChars + 1 + n * (valueChars + 1) - 1 <= capacity) best = n
  }
  return best
}

/** Parse an address token to an index, or null when invalid or out of range. */
function parseAddress(text: string, format: ValueFormat, depth: number): number | null {
  if (text.length === 0) return null
  let value: bigint
  try {
    value = format === 'HEX' ? BigInt(`0x${text}`) : format === 'BINARY' ? BigInt(`0b${text}`) : BigInt(text)
  } catch {
    return null
  }
  if (value < 0n || value > BigInt(Math.max(0, depth - 1))) return null
  return Number(value)
}

/**
 * Serialize a memory as address-prefixed `ADDR: value value …` text (the inverse of
 * `parseRomText`), in `format` with zero-padded addresses/values. `valuesPerLine` words
 * are grouped per line; the final line may be partial. The result round-trips through
 * `parseRomText`.
 */
export function formatRomText(
  mem: Signal[][],
  format: ValueFormat,
  dataWidth: number,
  busWidth: number,
  valuesPerLine = 8,
): string {
  const n = Math.max(1, Math.floor(valuesPerLine))
  const lines: string[] = []
  for (let start = 0; start < mem.length; start += n) {
    const words = mem.slice(start, Math.min(mem.length, start + n))
    const addr = formatAddress(start, format, busWidth)
    const values = words.map((w) => formatValue(w, format, dataWidth)).join(' ')
    lines.push(`${addr}: ${values}`)
  }
  return lines.join('\n')
}

/**
 * Parse a loaded file into a `depth`-word memory. The first non-empty line determines
 * the format: if its first token ends with `:`, the file is read as address-prefixed
 * `ADDR: val val …` lines (the `ADDR:` token carries the address); otherwise the file is
 * **data-only** — every whitespace/comma token is a value filling the memory from
 * address 0. Returns null on any invalid token or a malformed address line.
 */
export function parseRomText(
  text: string,
  format: ValueFormat,
  dataWidth: number,
  depth: number,
): Signal[][] | null {
  const w = Math.max(1, Math.floor(dataWidth))
  const n = Math.max(0, Math.floor(depth))
  const zero = (): Signal[] => Array.from({ length: w }, () => 0 as Signal)
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
  if (lines.length === 0) return Array.from({ length: n }, zero)

  const firstToken = lines[0].split(/[\s,;]+/).filter(Boolean)[0]
  const addressPrefixed = firstToken !== undefined && firstToken.endsWith(':')
  const mem: Signal[][] = []

  if (addressPrefixed) {
    for (const line of lines) {
      const tokens = line.split(/[\s,;]+/).filter(Boolean)
      if (tokens.length === 0) continue
      if (!tokens[0].endsWith(':')) return null
      const addr = parseAddress(tokens[0].slice(0, -1), format, n)
      if (addr === null) return null
      for (let k = 1; k < tokens.length; k++) {
        const index = addr + (k - 1)
        if (index >= n) break
        const word = parseValue(tokens[k], format, w)
        if (!word) return null
        while (mem.length < index) mem.push(zero())
        if (mem.length === index) mem.push(word)
        else mem[index] = word
      }
    }
  } else {
    for (const line of lines) {
      for (const token of line.split(/[\s,;]+/).filter(Boolean)) {
        if (mem.length >= n) break
        const word = parseValue(token, format, w)
        if (!word) return null
        mem.push(word)
      }
    }
  }

  while (mem.length < n) mem.push(zero())
  return mem
}
