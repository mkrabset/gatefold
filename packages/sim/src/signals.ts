import { invertSignal, type Signal } from '@gatefold/model'

/** 3-state NOT of a single bit (the canonical model implementation). */
export const invert = invertSignal

/** Bit-wise 3-state NOT over a bit-vector. */
export function invertVector(v: Signal[]): Signal[] {
  return v.map(invert)
}

/** Value equality of two signal vectors (length + elements). */
export function equalVectors(a: Signal[], b: Signal[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** Square-wave clock value at time `t` (ps) for a clock with `period` (ps). */
export function clockValue(period: number, t: number): Signal {
  if (period <= 0) return 0
  return t % period < period / 2 ? 1 : 0
}

/**
 * Add one to a bit-vector (little-endian, wrapping modulo 2^length). An unknown bit is
 * handled conservatively: the sum and carry-out at that position are unknown, so that
 * bit and every more-significant bit become `x`.
 */
export function incrementVector(v: Signal[]): Signal[] {
  const out: Signal[] = new Array(v.length)
  let carry: Signal = 1
  for (let i = 0; i < v.length; i++) {
    const bit = v[i]
    if (bit === 'x') {
      out[i] = 'x'
      carry = 'x'
    } else if (carry === 'x') {
      out[i] = 'x'
    } else if (carry === 1) {
      out[i] = bit === 0 ? 1 : 0
      carry = bit === 0 ? 0 : 1
    } else {
      out[i] = bit
    }
  }
  return out
}
