import { describe, expect, it } from 'vitest'
import { HistoryBuffer } from '../src/history'

describe('HistoryBuffer', () => {
  it('records events and reports them in chronological order', () => {
    const h = new HistoryBuffer(10, 'stop')
    h.setLabels(['a', 'b'])
    h.setBase(0, 0, 0)
    h.setBase(1, 0, 1)
    h.record(1, 5, 0)
    h.record(0, 10, 1)
    h.record(1, 15, 1)

    const events: { t: number; lane: number; value: 0 | 1 | 'x' }[] = []
    h.forEachEvent((e) => events.push(e))
    expect(events).toEqual([
      { t: 5, lane: 1, value: 0 },
      { t: 10, lane: 0, value: 1 },
      { t: 15, lane: 1, value: 1 },
    ])
    expect(h.count).toBe(3)
    expect(h.label(0)).toBe('a')
    expect(h.label(1)).toBe('b')
  })

  it('reports min/max time from bases and events', () => {
    const h = new HistoryBuffer(10, 'stop')
    h.setLabels(['a'])
    h.setBase(0, 0, 0)
    h.record(0, 100, 1)
    expect(h.minTime()).toBe(0)
    expect(h.maxTime()).toBe(100)
  })

  it('stops recording once full (stop mode) and sets the full flag', () => {
    const h = new HistoryBuffer(3, 'stop')
    h.setLabels(['a'])
    h.setBase(0, 0, 0)
    h.record(0, 1, 1)
    h.record(0, 2, 0)
    h.record(0, 3, 1)
    expect(h.count).toBe(3)
    expect(h.full).toBe(false)
    h.record(0, 4, 0)
    expect(h.count).toBe(3)
    expect(h.full).toBe(true)
    // Once full, further records are ignored.
    h.record(0, 5, 1)
    expect(h.count).toBe(3)
  })

  it('slides the oldest event out (ring buffer) when full in sliding mode', () => {
    const h = new HistoryBuffer(3, 'sliding')
    h.setLabels(['a', 'b'])
    h.setBase(0, 0, 0)
    h.setBase(1, 0, 1)
    h.record(0, 1, 1)
    h.record(1, 2, 0)
    h.record(0, 3, 0)
    // Full: next record evicts the oldest (lane 0 @ t=1), promoting it to lane 0's base.
    h.record(1, 4, 1)

    expect(h.count).toBe(3)
    expect(h.full).toBe(false)
    expect(h.baseOf(0)).toEqual({ t: 1, value: 1 })
    expect(h.baseOf(1)).toEqual({ t: 0, value: 1 })

    const events: { t: number; lane: number }[] = []
    h.forEachEvent((e) => events.push({ t: e.t, lane: e.lane }))
    expect(events).toEqual([
      { t: 2, lane: 1 },
      { t: 3, lane: 0 },
      { t: 4, lane: 1 },
    ])
    expect(h.minTime()).toBe(0)
    expect(h.maxTime()).toBe(4)
  })

  it('bumps its revision on every mutation', () => {
    const h = new HistoryBuffer(10, 'stop')
    const r0 = h.revision
    h.setLabels(['a'])
    expect(h.revision).toBeGreaterThan(r0)
    const r1 = h.revision
    h.setBase(0, 0, 0)
    expect(h.revision).toBeGreaterThan(r1)
    const r2 = h.revision
    h.record(0, 1, 1)
    expect(h.revision).toBeGreaterThan(r2)
  })

  it('groups a bus probe into contiguous lanes with flattened labels', () => {
    const h = new HistoryBuffer(10, 'stop')
    h.setGroups([
      { label: 'p', lanes: 3 },
      { label: 'q', lanes: 1 },
    ])

    expect(h.groupCount).toBe(2)
    expect(h.groupLabel(0)).toBe('p')
    expect(h.groupLabel(1)).toBe('q')
    expect(h.groupLanes(0)).toBe(3)
    expect(h.groupLanes(1)).toBe(1)
    expect(h.groupStart(0)).toBe(0)
    expect(h.groupStart(1)).toBe(3)

    expect(h.labelCount).toBe(4)
    expect(h.label(0)).toBe('p[0]')
    expect(h.label(1)).toBe('p[1]')
    expect(h.label(2)).toBe('p[2]')
    expect(h.label(3)).toBe('q')
  })
})
