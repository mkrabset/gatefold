import { describe, expect, it } from 'vitest'
import type { ComponentDef, CompositeDef, Design, Instance, PinRef } from '@gatefold/model'
import { withBuiltinPrimitives } from '@gatefold/model'
import { findJoinpointWire, findWireAtLine } from './wireSearch'

const iref = (instanceId: string, portId: string): PinRef => ({ instanceId, portId })
const inst = (id: string, defId: string, x: number, y: number): Instance => ({ id, name: id, defId, pos: { x, y } })

function mkDesign(instances: Instance[], connections: CompositeDef['connections']): { design: Design; main: ComponentDef } {
  const main: ComponentDef = { id: 'main', name: 'main', kind: 'composite', ports: [], instances, connections }
  return { design: withBuiltinPrimitives({ version: 1, root: 'main', library: {}, defs: { main } }), main }
}

describe('findWireAtLine', () => {
  it('returns the connection and crossing point for a unique single-wire crossing', () => {
    const { design, main } = mkDesign(
      [inst('b1', 'buffer', 0, 0), inst('b2', 'buffer', 100, 0)],
      [{ id: 'c1', from: iref('b1', 'out:0'), to: iref('b2', 'in:0') }],
    )
    // b1.out:0 → (24, 0), b2.in:0 → (76, 0); a straight horizontal wire. A vertical
    // segment at x=50 crosses it at (50, 0).
    const hit = findWireAtLine(design, main, { x: 50, y: -10 }, { x: 50, y: 10 })
    expect(hit).not.toBeNull()
    expect(hit!.connection.id).toBe('c1')
    expect(hit!.point.x).toBeCloseTo(50, 3)
    expect(hit!.point.y).toBeCloseTo(0, 3)
  })

  it('returns null when the segment crosses no wire', () => {
    const { design, main } = mkDesign(
      [inst('b1', 'buffer', 0, 0), inst('b2', 'buffer', 100, 0)],
      [{ id: 'c1', from: iref('b1', 'out:0'), to: iref('b2', 'in:0') }],
    )
    expect(findWireAtLine(design, main, { x: 50, y: 50 }, { x: 50, y: 60 })).toBeNull()
  })

  it('returns null when two wires are both crossed (ambiguous)', () => {
    const { design, main } = mkDesign(
      [inst('b1', 'buffer', 0, 0), inst('b2', 'buffer', 100, 0), inst('b3', 'buffer', 0, 40), inst('b4', 'buffer', 100, 40)],
      [
        { id: 'c1', from: iref('b1', 'out:0'), to: iref('b2', 'in:0') },
        { id: 'c2', from: iref('b3', 'out:0'), to: iref('b4', 'in:0') },
      ],
    )
    // A vertical segment crossing both horizontal wires (y=0 and y=40).
    expect(findWireAtLine(design, main, { x: 50, y: -10 }, { x: 50, y: 50 })).toBeNull()
  })

  it('returns null when the crossing is a bus (never a single wire)', () => {
    const { design, main } = mkDesign(
      [inst('sw1', 'switch-array', 0, -20), inst('sw2', 'switch-array', 0, 20), inst('fi', 'fan-in', 60, 0), inst('fo', 'fan-out', 160, 0)],
      [
        { id: 'c1', from: iref('sw1', 'out:0'), to: iref('fi', 'in:0') },
        { id: 'c2', from: iref('sw2', 'out:0'), to: iref('fi', 'in:1') },
        { id: 'c3', from: iref('fi', 'out:0'), to: iref('fo', 'in:0') },
      ],
    )
    // fi.out:0 → fo.in:0 is a width-2 bus (two lanes); a vertical segment at x=110
    // crosses both lanes → ambiguous → null.
    expect(findWireAtLine(design, main, { x: 110, y: -10 }, { x: 110, y: 10 })).toBeNull()
  })

  it('returns null for a degenerate (zero-length) segment', () => {
    const { design, main } = mkDesign(
      [inst('b1', 'buffer', 0, 0), inst('b2', 'buffer', 100, 0)],
      [{ id: 'c1', from: iref('b1', 'out:0'), to: iref('b2', 'in:0') }],
    )
    expect(findWireAtLine(design, main, { x: 50, y: 0 }, { x: 50, y: 0 })).toBeNull()
  })
})

describe('findJoinpointWire', () => {
  it('finds the wire under the drop point', () => {
    const { design, main } = mkDesign(
      [inst('b1', 'buffer', 0, 0), inst('b2', 'buffer', 100, 0)],
      [{ id: 'c1', from: iref('b1', 'out:0'), to: iref('b2', 'in:0') }],
    )
    const hit = findJoinpointWire(design, main, { x: 50, y: 0 })
    expect(hit).not.toBeNull()
    expect(hit!.connection.id).toBe('c1')
  })

  it('finds a wire when the drop is slightly off the wire', () => {
    const { design, main } = mkDesign(
      [inst('b1', 'buffer', 0, 0), inst('b2', 'buffer', 100, 0)],
      [{ id: 'c1', from: iref('b1', 'out:0'), to: iref('b2', 'in:0') }],
    )
    expect(findJoinpointWire(design, main, { x: 50, y: 6 })?.connection.id).toBe('c1')
  })

  it('returns null when no wire is near', () => {
    const { design, main } = mkDesign(
      [inst('b1', 'buffer', 0, 0), inst('b2', 'buffer', 100, 0)],
      [{ id: 'c1', from: iref('b1', 'out:0'), to: iref('b2', 'in:0') }],
    )
    expect(findJoinpointWire(design, main, { x: 50, y: 60 })).toBeNull()
  })

  it('returns null when two wires are both crossed (ambiguous)', () => {
    const { design, main } = mkDesign(
      [inst('b1', 'buffer', 0, 0), inst('b2', 'buffer', 100, 0), inst('b3', 'buffer', 0, 20), inst('b4', 'buffer', 100, 20)],
      [
        { id: 'c1', from: iref('b1', 'out:0'), to: iref('b2', 'in:0') },
        { id: 'c2', from: iref('b3', 'out:0'), to: iref('b4', 'in:0') },
      ],
    )
    expect(findJoinpointWire(design, main, { x: 50, y: 10 })).toBeNull()
  })

  it('returns null when the two diagonals resolve to different connections', () => {
    // Two short horizontal wires over x∈[30,50] at y=-10 and y=+10. Dropping at (50,0),
    // the "\" diagonal crosses only the upper wire and the "/" diagonal only the lower
    // one — two different connections, so the result is null.
    const { design, main } = mkDesign(
      [
        inst('a1', 'buffer', 6, -10), inst('a2', 'buffer', 74, -10),
        inst('b1', 'buffer', 6, 10), inst('b2', 'buffer', 74, 10),
      ],
      [
        { id: 'ca', from: iref('a1', 'out:0'), to: iref('a2', 'in:0') },
        { id: 'cb', from: iref('b1', 'out:0'), to: iref('b2', 'in:0') },
      ],
    )
    expect(findJoinpointWire(design, main, { x: 50, y: 0 })).toBeNull()
  })
})
