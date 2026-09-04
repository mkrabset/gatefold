import { describe, expect, it } from 'vitest'
import type { Connection, Design, PinRef } from '../src/types'
import { findConnectionTo, isDefReferenced, nextConnectionId, pinRefEquals } from '../src/types'

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

describe('nextConnectionId', () => {
  it('returns c1 for empty connections and skips collisions', () => {
    expect(nextConnectionId([])).toBe('c1')
    expect(nextConnectionId([conn('c1', iRef('a', 'out:0'), iRef('b', 'in:0'))])).toBe('c2')
    const cs = [conn('c1', iRef('a', 'out:0'), iRef('b', 'in:0')), conn('c2', iRef('a', 'out:0'), iRef('c', 'in:0'))]
    expect(nextConnectionId(cs)).toBe('c3')
  })

  it('skips a non-sequential collision', () => {
    const cs = [conn('c1', iRef('a', 'out:0'), iRef('b', 'in:0')), conn('c3', iRef('a', 'out:0'), iRef('c', 'in:0'))]
    expect(nextConnectionId(cs)).toBe('c4')
  })
})

describe('isDefReferenced', () => {
  it('detects when an instance references a def', () => {
    const design: Design = {
      version: 1,
      root: 'main',
      defs: {
        main: {
          id: 'main',
          name: 'main',
          kind: 'composite',
          ports: [],
          instances: [{ id: 'x1', name: 'x1', defId: 'foo', pos: { x: 0, y: 0 } }],
          connections: [],
        },
        foo: { id: 'foo', name: 'foo', kind: 'composite', ports: [], instances: [], connections: [] },
        bar: { id: 'bar', name: 'bar', kind: 'composite', ports: [], instances: [], connections: [] },
      },
    }
    expect(isDefReferenced(design, 'foo')).toBe(true)
    expect(isDefReferenced(design, 'bar')).toBe(false)
  })
})
