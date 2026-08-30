import { describe, expect, it } from 'vitest'
import { wirePath } from './routing'

describe('wirePath', () => {
  it('offsets control points by one half of the horizontal distance', () => {
    const a = { x: 0, y: 0 }
    const b = { x: 30, y: 20 }
    const p = wirePath(a, b)
    expect(p.start).toEqual({ x: 0, y: 0 })
    expect(p.c1).toEqual({ x: 15, y: 0 })
    expect(p.c2).toEqual({ x: 15, y: 20 })
    expect(p.end).toEqual({ x: 30, y: 20 })
  })

  it('keeps horizontal tangents (control points share terminal Y)', () => {
    const a = { x: 100, y: 50 }
    const b = { x: 160, y: 80 }
    const p = wirePath(a, b)
    expect(p.c1.y).toBe(a.y)
    expect(p.c2.y).toBe(b.y)
    expect(p.c1.x).toBe(a.x + (b.x - a.x) / 2)
    expect(p.c2.x).toBe(b.x - (b.x - a.x) / 2)
  })

  it('collapses the nearest control point onto a join-point endpoint', () => {
    const a = { x: 0, y: 0 }
    const b = { x: 40, y: 10 }

    const fromJoin = wirePath(a, b, { fromJoin: true })
    expect(fromJoin.c1).toEqual(a)
    expect(fromJoin.c2).toEqual({ x: b.x - 20, y: b.y })

    const toJoin = wirePath(a, b, { toJoin: true })
    expect(toJoin.c1).toEqual({ x: a.x + 20, y: a.y })
    expect(toJoin.c2).toEqual(b)

    const both = wirePath(a, b, { fromJoin: true, toJoin: true })
    expect(both.c1).toEqual(a)
    expect(both.c2).toEqual(b)
  })
})
