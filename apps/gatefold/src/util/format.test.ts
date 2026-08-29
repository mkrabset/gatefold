import { describe, expect, it } from 'vitest'
import { formatFrequency, formatSpeed } from './format'

describe('formatFrequency', () => {
  it('uses Hz below 1000', () => {
    expect(formatFrequency(999.999)).toBe('999.999 Hz')
    expect(formatFrequency(500)).toBe('500 Hz')
    expect(formatFrequency(0.5)).toBe('0.5 Hz')
  })

  it('uses kHz from 1000 up to 1_000_000', () => {
    expect(formatFrequency(1000)).toBe('1 kHz')
    expect(formatFrequency(1500)).toBe('1.5 kHz')
    expect(formatFrequency(1234.56789)).toBe('1.235 kHz')
  })

  it('uses MHz from 1_000_000 up', () => {
    expect(formatFrequency(1_000_000)).toBe('1 MHz')
    expect(formatFrequency(10_000_000)).toBe('10 MHz')
    expect(formatFrequency(1_234_567.89)).toBe('1.235 MHz')
  })

  it('strips trailing zeros', () => {
    expect(formatFrequency(2000)).toBe('2 kHz')
    expect(formatFrequency(2_000_000)).toBe('2 MHz')
  })
})

describe('formatSpeed', () => {
  it('reports faster than real-time', () => {
    expect(formatSpeed(10)).toBe('10x faster')
    expect(formatSpeed(2.5)).toBe('2.5x faster')
    expect(formatSpeed(1.2345678)).toBe('1.235x faster')
  })

  it('reports slower than real-time', () => {
    expect(formatSpeed(0.005)).toBe('200x slower')
    expect(formatSpeed(0.3)).toBe('3.333x slower')
  })

  it('reports real-time at exactly 1', () => {
    expect(formatSpeed(1)).toBe('real-time')
  })

  it('strips trailing zeros', () => {
    expect(formatSpeed(2)).toBe('2x faster')
    expect(formatSpeed(0.5)).toBe('2x slower')
  })
})
