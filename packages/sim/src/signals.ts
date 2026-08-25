import type { Signal } from '@gatefold/model'

/** 3-state NOT of a single bit. */
export function invert(s: Signal): Signal {
  return s === 'x' ? 'x' : s === 0 ? 1 : 0
}

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
