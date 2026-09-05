import { describe, expect, it } from 'vitest'
import type { CompositeDef, Design, Instance, PinRef, PrimitiveKind } from '@gatefold/model'
import { forkOf } from '@gatefold/model'
import { findJoinpointWire, findWireAtLine } from './wireSearch'

const iref = (instanceId: string, portId: string): PinRef => ({ instanceId, portId })
const inst = (id: string, defId: PrimitiveKind, x: number, y: number): Instance => ({ id, name: id, def: forkOf(defId), pos: { x, y } })

function mkDesign(instances: Instance[], connections: CompositeDef['connections']): { design: Design; main: CompositeDef } {
  const main: CompositeDef = { id: 'main', name: 'main', kind: 'composite', ports: [], instances, connections }
  return { design: { version: 2, root: main, library: {} }, main }
}

describe('findWireAtLine', () => {
  it('returns the connection and crossing point for a unique single-wire crossing', () => {
    const { main } = mkDesign(
      [inst('b1', 'buffer', 0, 0), inst('b2', 'buffer', 100, 0)],
      [{ id: 'c1', from: iref('b1', 'out:0'), to: iref('b2', 'in:0') }],
    )
    const hit = findWireAtLine(main, { x: 50, y: -10 }, { x: 50, y: 10 })
    expect(hit).not.toBeNull()
    expect(hit!.connection.id).toBe('c1')
    expect(hit!.point.x).toBeCloseTo(50, 3)
    expect(hit!.point.y).toBeCloseTo(0, 3)
  })

  it('returns null when the segment crosses no wire', () => {
    const { main } = mkDesign(
      [inst('b1', 'buffer', 0, 0), inst('b2', 'buffer', 100, 0)],
      [{ id: 'c1', from: iref('b1', 'out:0'), to: iref('b2', 'in:0') }],
    )
    expect(findWireAtLine(main, { x: 50, y: 50 }, { x: 50, y: 60 })).toBeNull()
  })

  it('returns null when two wires are both crossed (ambiguous)', () => {
    const { main } = mkDesign(
      [inst('b1', 'buffer', 0, 0), inst('b2', 'buffer', 100, 0), inst('b3', 'buffer', 0, 40), inst('b4', 'buffer', 100, 40)],
      [
        { id: 'c1', from: iref('b1', 'out:0'), to: iref('b2', 'in:0') },
        { id: 'c2', from: iref('b3', 'out:0'), to: iref('b4', 'in:0') },
      ],
    )
    expect(findWireAtLine(main, { x: 50, y: -10 }, { x: 50, y: 50 })).toBeNull()
  })

  it('returns null when the crossing is a bus (never a single wire)', () => {
    const { main } = mkDesign(
      [inst('sw1', 'switch-array', 0, -20), inst('sw2', 'switch-array', 0, 20), inst('fi', 'fan-in', 60, 0), inst('fo', 'fan-out', 160, 0)],
      [
        { id: 'c1', from: iref('sw1', 'out:0'), to: iref('fi', 'in:0') },
        { id: 'c2', from: iref('sw2', 'out:0'), to: iref('fi', 'in:1') },
        { id: 'c3', from: iref('fi', 'out:0'), to: iref('fo', 'in:0') },
      ],
    )
    expect(findWireAtLine(main, { x: 110, y: -10 }, { x: 110, y: 10 })).toBeNull()
  })

  it('returns null for a degenerate (zero-length) segment', () => {
    const { main } = mkDesign(
      [inst('b1', 'buffer', 0, 0), inst('b2', 'buffer', 100, 0)],
      [{ id: 'c1', from: iref('b1', 'out:0'), to: iref('b2', 'in:0') }],
    )
    expect(findWireAtLine(main, { x: 50, y: 0 }, { x: 50, y: 0 })).toBeNull()
  })
})

describe('findJoinpointWire', () => {
  it('finds the wire under the drop point', () => {
    const { main } = mkDesign(
      [inst('b1', 'buffer', 0, 0), inst('b2', 'buffer', 100, 0)],
      [{ id: 'c1', from: iref('b1', 'out:0'), to: iref('b2', 'in:0') }],
    )
    const hit = findJoinpointWire(main, { x: 50, y: 0 })
    expect(hit).not.toBeNull()
    expect(hit!.connection.id).toBe('c1')
  })

  it('finds a wire when the drop is slightly off the wire', () => {
    const { main } = mkDesign(
      [inst('b1', 'buffer', 0, 0), inst('b2', 'buffer', 100, 0)],
      [{ id: 'c1', from: iref('b1', 'out:0'), to: iref('b2', 'in:0') }],
    )
    expect(findJoinpointWire(main, { x: 50, y: 6 })?.connection.id).toBe('c1')
  })

  it('returns null when no wire is near', () => {
    const { main } = mkDesign(
      [inst('b1', 'buffer', 0, 0), inst('b2', 'buffer', 100, 0)],
      [{ id: 'c1', from: iref('b1', 'out:0'), to: iref('b2', 'in:0') }],
    )
    expect(findJoinpointWire(main, { x: 50, y: 60 })).toBeNull()
  })

  it('returns null when two wires are both crossed (ambiguous)', () => {
    const { main } = mkDesign(
      [inst('b1', 'buffer', 0, 0), inst('b2', 'buffer', 100, 0), inst('b3', 'buffer', 0, 20), inst('b4', 'buffer', 100, 20)],
      [
        { id: 'c1', from: iref('b1', 'out:0'), to: iref('b2', 'in:0') },
        { id: 'c2', from: iref('b3', 'out:0'), to: iref('b4', 'in:0') },
      ],
    )
    expect(findJoinpointWire(main, { x: 50, y: 10 })).toBeNull()
  })

  it('returns null when the two diagonals resolve to different connections', () => {
    const { main } = mkDesign(
      [
        inst('a1', 'buffer', 6, -10), inst('a2', 'buffer', 74, -10),
        inst('b1', 'buffer', 6, 10), inst('b2', 'buffer', 74, 10),
      ],
      [
        { id: 'ca', from: iref('a1', 'out:0'), to: iref('a2', 'in:0') },
        { id: 'cb', from: iref('b1', 'out:0'), to: iref('b2', 'in:0') },
      ],
    )
    expect(findJoinpointWire(main, { x: 50, y: 0 })).toBeNull()
  })
})
