import { describe, expect, it } from 'vitest'
import {
  applyValueOrder,
  formatSwitchValue,
  maxSwitchValueText,
  parseSwitchValue,
  switchInitialLanes,
  toValueFormat,
  valueFormatOf,
  valueOrderOf,
} from '../src/value'

describe('value format/order resolution', () => {
  it('narrows any value to a ValueFormat, defaulting to HEX', () => {
    expect(toValueFormat(undefined)).toBe('HEX')
    expect(toValueFormat('DEC')).toBe('DEC')
    expect(toValueFormat('SIGNED DEC')).toBe('SIGNED DEC')
    expect(toValueFormat('garbage')).toBe('HEX')
  })

  it('resolves the switch valueFormat property', () => {
    expect(valueFormatOf(undefined)).toBe('HEX')
    expect(valueFormatOf({})).toBe('HEX')
    expect(valueFormatOf({ valueFormat: 'DEC' })).toBe('DEC')
    expect(valueFormatOf({ valueFormat: 'SIGNED DEC' })).toBe('SIGNED DEC')
    expect(valueFormatOf({ valueFormat: 'junk' })).toBe('HEX')
  })

  it('resolves the switch order property', () => {
    expect(valueOrderOf(undefined)).toBe('asc')
    expect(valueOrderOf({})).toBe('asc')
    expect(valueOrderOf({ order: 'asc' })).toBe('asc')
    expect(valueOrderOf({ order: 'desc' })).toBe('desc')
    expect(valueOrderOf({ order: 'junk' })).toBe('asc')
  })
})

describe('parseSwitchValue', () => {
  it('parses HEX, least-significant bit first', () => {
    expect(parseSwitchValue('0', 'HEX', 4)).toEqual([0, 0, 0, 0])
    expect(parseSwitchValue('F', 'HEX', 4)).toEqual([1, 1, 1, 1])
    expect(parseSwitchValue('FF', 'HEX', 8)).toEqual([1, 1, 1, 1, 1, 1, 1, 1])
    expect(parseSwitchValue('10', 'HEX', 8)).toEqual([0, 0, 0, 0, 1, 0, 0, 0])
    expect(parseSwitchValue('ff', 'HEX', 8)).toEqual([1, 1, 1, 1, 1, 1, 1, 1])
  })

  it('rejects invalid or out-of-range HEX', () => {
    expect(parseSwitchValue('', 'HEX', 4)).toBeNull()
    expect(parseSwitchValue('G', 'HEX', 4)).toBeNull()
    expect(parseSwitchValue('0x', 'HEX', 4)).toBeNull()
    expect(parseSwitchValue('100', 'HEX', 8)).toBeNull() // 256 > 255
  })

  it('parses unsigned DEC', () => {
    expect(parseSwitchValue('0', 'DEC', 4)).toEqual([0, 0, 0, 0])
    expect(parseSwitchValue('12', 'DEC', 4)).toEqual([0, 0, 1, 1])
    expect(parseSwitchValue('255', 'DEC', 8)).toEqual([1, 1, 1, 1, 1, 1, 1, 1])
  })

  it('rejects invalid or out-of-range DEC', () => {
    expect(parseSwitchValue('12a', 'DEC', 4)).toBeNull()
    expect(parseSwitchValue('-1', 'DEC', 4)).toBeNull()
    expect(parseSwitchValue('256', 'DEC', 8)).toBeNull()
  })

  it('parses signed DEC over two\'s-complement range', () => {
    expect(parseSwitchValue('7', 'SIGNED DEC', 4)).toEqual([1, 1, 1, 0])
    expect(parseSwitchValue('0', 'SIGNED DEC', 4)).toEqual([0, 0, 0, 0])
    expect(parseSwitchValue('-1', 'SIGNED DEC', 4)).toEqual([1, 1, 1, 1])
    expect(parseSwitchValue('-8', 'SIGNED DEC', 4)).toEqual([0, 0, 0, 1])
    expect(parseSwitchValue('+3', 'SIGNED DEC', 4)).toEqual([1, 1, 0, 0])
  })

  it('rejects invalid or out-of-range signed DEC', () => {
    expect(parseSwitchValue('', 'SIGNED DEC', 4)).toBeNull()
    expect(parseSwitchValue('abc', 'SIGNED DEC', 4)).toBeNull()
    expect(parseSwitchValue('1.5', 'SIGNED DEC', 4)).toBeNull()
    expect(parseSwitchValue('8', 'SIGNED DEC', 4)).toBeNull() // > 7
    expect(parseSwitchValue('-9', 'SIGNED DEC', 4)).toBeNull() // < -8
  })
})

describe('formatSwitchValue', () => {
  it('formats HEX zero-padded to nibbles', () => {
    expect(formatSwitchValue([0, 0, 0, 0], 'HEX')).toBe('0')
    expect(formatSwitchValue([1, 1, 1, 1], 'HEX')).toBe('F')
    expect(formatSwitchValue([1, 1, 1, 1, 1, 1, 1, 1], 'HEX')).toBe('FF')
    expect(formatSwitchValue([1, 0], 'HEX')).toBe('1')
  })

  it('formats unsigned DEC', () => {
    expect(formatSwitchValue([1, 1, 1, 1], 'DEC')).toBe('15')
    expect(formatSwitchValue([0, 0, 0, 0, 1, 0, 0, 0], 'DEC')).toBe('16')
  })

  it('formats signed DEC with a leading minus', () => {
    expect(formatSwitchValue([1, 1, 1, 0], 'SIGNED DEC')).toBe('7')
    expect(formatSwitchValue([1, 1, 1, 1], 'SIGNED DEC')).toBe('-1')
    expect(formatSwitchValue([1, 0, 0, 0, 0, 0, 0, 0], 'SIGNED DEC')).toBe('1')
  })
})

describe('switchInitialLanes', () => {
  it('supports legacy boolean values (true = all ones, false = all zeros)', () => {
    expect(switchInitialLanes({ initialValue: true }, 4)).toEqual([1, 1, 1, 1])
    expect(switchInitialLanes({ initialValue: false }, 4)).toEqual([0, 0, 0, 0])
  })

  it('parses a string in the instance valueFormat (default HEX), ascending order', () => {
    expect(switchInitialLanes({ initialValue: 'F' }, 4)).toEqual([1, 1, 1, 1])
    expect(switchInitialLanes({ initialValue: 'A', valueFormat: 'HEX' }, 4)).toEqual([0, 1, 0, 1])
    expect(switchInitialLanes({ initialValue: '12', valueFormat: 'DEC' }, 4)).toEqual([0, 0, 1, 1])
    expect(switchInitialLanes({ initialValue: '-1', valueFormat: 'SIGNED DEC' }, 4)).toEqual([1, 1, 1, 1])
  })

  it('applies the order property to map bits onto lanes', () => {
    expect(switchInitialLanes({ initialValue: '8', valueFormat: 'HEX', order: 'asc' }, 4)).toEqual([0, 0, 0, 1])
    expect(switchInitialLanes({ initialValue: '8', valueFormat: 'HEX', order: 'desc' }, 4)).toEqual([1, 0, 0, 0])
  })

  it('falls back to all zeros on missing/invalid/out-of-range text', () => {
    expect(switchInitialLanes({}, 4)).toEqual([0, 0, 0, 0])
    expect(switchInitialLanes({ initialValue: '' }, 4)).toEqual([0, 0, 0, 0])
    expect(switchInitialLanes({ initialValue: 'G' }, 4)).toEqual([0, 0, 0, 0])
    expect(switchInitialLanes({ initialValue: '100', valueFormat: 'HEX' }, 8)).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })
})

describe('applyValueOrder', () => {
  it('reverses for desc and copies (never mutates) for asc', () => {
    const bits = [1, 0, 1, 0]
    const asc = applyValueOrder(bits, 'asc')
    expect(asc).toEqual([1, 0, 1, 0])
    expect(applyValueOrder(bits, 'desc')).toEqual([0, 1, 0, 1])
    expect(bits).toEqual([1, 0, 1, 0]) // unchanged
    expect(asc).not.toBe(bits) // a fresh array
  })
})

describe('maxSwitchValueText', () => {
  it('pads HEX to full nibbles', () => {
    expect(maxSwitchValueText(4, 'HEX')).toBe('F')
    expect(maxSwitchValueText(5, 'HEX')).toBe('FF')
    expect(maxSwitchValueText(32, 'HEX')).toBe('FFFFFFFF')
  })

  it('uses the full unsigned range for DEC', () => {
    expect(maxSwitchValueText(1, 'DEC')).toBe('1')
    expect(maxSwitchValueText(8, 'DEC')).toBe('255')
    expect(maxSwitchValueText(32, 'DEC')).toBe('4294967295')
  })

  it('uses the most-negative value for SIGNED DEC (longest)', () => {
    expect(maxSwitchValueText(1, 'SIGNED DEC')).toBe('-1')
    expect(maxSwitchValueText(8, 'SIGNED DEC')).toBe('-128')
    expect(maxSwitchValueText(32, 'SIGNED DEC')).toBe('-2147483648')
  })

  it('returns a placeholder for invalid widths', () => {
    expect(maxSwitchValueText(0, 'HEX')).toBe('?')
    expect(maxSwitchValueText(2.5, 'HEX')).toBe('?')
  })
})
