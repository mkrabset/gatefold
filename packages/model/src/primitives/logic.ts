import type { Signal } from '../types'

/**
 * 3-state logic helpers (`0`, `1`, `'x'`) shared by primitive `transfer` implementations.
 * `'x'` (unknown/high-impedance) propagates through a gate unless a dominating input
 * decides the result.
 */

/** 3-state AND over a bit vector — `0` dominates. */
export function andBits(bits: Signal[]): Signal {
  if (bits.includes(0)) return 0
  if (bits.includes('x')) return 'x'
  return 1
}

/** 3-state OR over a bit vector — `1` dominates. */
export function orBits(bits: Signal[]): Signal {
  if (bits.includes(1)) return 1
  if (bits.includes('x')) return 'x'
  return 0
}

/** 3-state XOR (odd parity) over a bit vector. */
export function xorBits(bits: Signal[]): Signal {
  if (bits.includes('x')) return 'x'
  return bits.filter((b) => b === 1).length % 2 === 1 ? 1 : 0
}

/** 3-state NOT of a single bit (`x` stays `x`). */
export function invertSignal(s: Signal): Signal {
  return s === 'x' ? 'x' : s === 0 ? 1 : 0
}
