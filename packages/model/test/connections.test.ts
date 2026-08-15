import { describe, expect, it } from 'vitest'
import type { Connection, PinRef } from '../src/types'
import { findConnectionTo, pinRefEquals } from '../src/types'

const iRef = (instanceId: string, portId: string): PinRef => ({ instanceId, portId })
const conn = (id: string, from: PinRef, to: PinRef): Connection => ({ id, from, to })

describe('pinRefEquals', () => {
  it('compares instance pins structurally', () => {
    expect(pinRefEquals(iRef('a', 'out:0'), iRef('a', 'out:0'))).toBe(true)
    expect(pinRefEquals(iRef('a', 'out:0'), iRef('b', 'out:0'))).toBe(false)
    expect(pinRefEquals(iRef('a', 'out:0'), iRef('a', 'out:1'))).toBe(false)
  })
})

describe('findConnectionTo', () => {
  it('returns the single driver of a sink, or null', () => {
    const cs = [conn('c1', iRef('a', 'out:0'), iRef('b', 'in:0'))]
    expect(findConnectionTo(cs, iRef('b', 'in:0'))?.id).toBe('c1')
    expect(findConnectionTo(cs, iRef('b', 'in:1'))).toBeNull()
    expect(findConnectionTo(cs, iRef('c', 'in:0'))).toBeNull()
  })
})
