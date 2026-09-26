import { describe, expect, it } from 'vitest'
import { addrCharCount, applyDigit, formatAddress, formatValue, parseRomText, valueCharCount, valuesPerLineFor } from './romEditor'

/** A `width`-bit word (LSB-first) from a hex literal. */
function word(hex: string, width: number): (0 | 1)[] {
  const v = BigInt(`0x${hex}`)
  const bits: (0 | 1)[] = []
  for (let i = 0; i < width; i++) bits.push(((v >> BigInt(i)) & 1n) === 1n ? 1 : 0)
  return bits
}

describe('romEditor digit counts', () => {
  it('pads HEX addresses/values to whole nibbles', () => {
    expect(addrCharCount('HEX', 12)).toBe(3)
    expect(addrCharCount('HEX', 8)).toBe(2)
    expect(addrCharCount('HEX', 1)).toBe(1)
    expect(valueCharCount('HEX', 8)).toBe(2)
    expect(valueCharCount('HEX', 5)).toBe(2)
  })

  it('pads BINARY to the full bit width', () => {
    expect(addrCharCount('BINARY', 12)).toBe(12)
    expect(valueCharCount('BINARY', 8)).toBe(8)
  })

  it('pads DEC to the digit count of the max value (BigInt-safe)', () => {
    expect(addrCharCount('DEC', 12)).toBe(4) // 4095
    expect(valueCharCount('DEC', 8)).toBe(3) // 255
    expect(valueCharCount('DEC', 64)).toBe(20) // 2^64 - 1
  })
})

describe('formatAddress / formatValue', () => {
  it('formats addresses zero-padded in each radix', () => {
    expect(formatAddress(0, 'HEX', 12)).toBe('000')
    expect(formatAddress(8, 'HEX', 12)).toBe('008')
    expect(formatAddress(0xfff, 'HEX', 12)).toBe('FFF')
    expect(formatAddress(2, 'BINARY', 12)).toBe('000000000010')
    expect(formatAddress(0, 'DEC', 12)).toBe('0000')
    expect(formatAddress(8, 'DEC', 12)).toBe('0008')
    expect(formatAddress(4095, 'DEC', 12)).toBe('4095')
  })

  it('formats values zero-padded in each radix', () => {
    expect(formatValue(word('0A', 8), 'HEX', 8)).toBe('0A')
    expect(formatValue(word('0A', 8), 'BINARY', 8)).toBe('00001010')
    expect(formatValue(word('0A', 8), 'DEC', 8)).toBe('010')
  })
})

describe('valuesPerLineFor', () => {
  it('snaps to the largest of 1/2/4/8 that fits', () => {
    expect(valuesPerLineFor(80, 3, 2)).toBe(8)
    expect(valuesPerLineFor(20, 3, 2)).toBe(4)
    expect(valuesPerLineFor(10, 3, 2)).toBe(2)
    expect(valuesPerLineFor(6, 3, 2)).toBe(1)
    expect(valuesPerLineFor(1, 10, 10)).toBe(1)
  })
})

describe('applyDigit', () => {
  it('sets a HEX nibble (leftmost digit = most-significant)', () => {
    expect(formatValue(applyDigit(word('00', 8), 'HEX', 8, 0, 'A'), 'HEX', 8)).toBe('A0')
    expect(formatValue(applyDigit(word('00', 8), 'HEX', 8, 1, 'a'), 'HEX', 8)).toBe('0A')
    expect(formatValue(applyDigit(word('FF', 8), 'HEX', 8, 1, '0'), 'HEX', 8)).toBe('F0')
  })

  it('sets a BINARY bit (leftmost digit = most-significant)', () => {
    expect(formatValue(applyDigit(word('0', 4), 'BINARY', 4, 0, '1'), 'BINARY', 4)).toBe('1000')
    expect(formatValue(applyDigit(word('0', 4), 'BINARY', 4, 3, '1'), 'BINARY', 4)).toBe('0001')
  })

  it('replaces a DEC digit and clamps to the width', () => {
    // 250 = FA -> "250"; typing 3 in the hundreds clamps to 255.
    expect(formatValue(applyDigit(word('FA', 8), 'DEC', 8, 0, '3'), 'DEC', 8)).toBe('255')
    expect(formatValue(applyDigit(word('FA', 8), 'DEC', 8, 0, '1'), 'DEC', 8)).toBe('150')
    expect(formatValue(applyDigit(word('FA', 8), 'DEC', 8, 2, '5'), 'DEC', 8)).toBe('255')
  })

  it('ignores invalid digits', () => {
    expect(formatValue(applyDigit(word('0A', 8), 'HEX', 8, 0, 'G'), 'HEX', 8)).toBe('0A')
    expect(formatValue(applyDigit(word('5', 8), 'BINARY', 8, 0, '2'), 'BINARY', 8)).toBe('00000101')
    expect(formatValue(applyDigit(word('FA', 8), 'DEC', 8, 0, 'x'), 'DEC', 8)).toBe('250')
  })
})

describe('parseRomText', () => {
  it('is data-only by default (no address prefix)', () => {
    expect(parseRomText('00 01 02 03', 'HEX', 8, 4)).toEqual([
      word('00', 8), word('01', 8), word('02', 8), word('03', 8),
    ])
  })

  it('parses ADDR:-prefixed lines into the given addresses', () => {
    expect(parseRomText('000: 01 02\n002: 03 04', 'HEX', 8, 4)).toEqual([
      word('01', 8), word('02', 8), word('03', 8), word('04', 8),
    ])
  })

  it('fills gaps between address-prefixed lines with zeros', () => {
    expect(parseRomText('000: 01\n002: 02', 'HEX', 8, 4)).toEqual([
      word('01', 8), word('00', 8), word('02', 8), word('00', 8),
    ])
  })

  it('treats values that look like addresses as data when there is no colon', () => {
    expect(parseRomText('05 06 07 08', 'HEX', 8, 4)).toEqual([
      word('05', 8), word('06', 8), word('07', 8), word('08', 8),
    ])
  })

  it('treats single-token lines as a flat list', () => {
    expect(parseRomText('00\n01\n02\n03', 'HEX', 8, 4)).toEqual([
      word('00', 8), word('01', 8), word('02', 8), word('03', 8),
    ])
  })

  it('parses DEC address-prefixed files', () => {
    expect(parseRomText('0: 5\n1: 7', 'DEC', 8, 4)).toEqual([
      word('05', 8), word('07', 8), word('00', 8), word('00', 8),
    ])
  })

  it('returns null on invalid tokens', () => {
    expect(parseRomText('01 GG', 'HEX', 8, 4)).toBeNull()
    expect(parseRomText('000: 01 GG', 'HEX', 8, 4)).toBeNull()
  })

  it('returns null when an address-prefixed line lacks a colon', () => {
    expect(parseRomText('000: 01\n002 02', 'HEX', 8, 4)).toBeNull()
  })
})
