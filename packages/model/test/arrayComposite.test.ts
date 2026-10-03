import { describe, expect, it } from 'vitest'
import type { ChildDef, CompositeDef, Connection, Instance, PinRef } from '../src/types'
import { arrayComposite } from '../src/array'
import { cloneComposite } from '../src/group'
import { parseDesign, serializeDesign } from '../src/serialize'
import { resolvedPinWidth } from '../src/widths'
import { inputPorts, outputPorts } from '../src/ports'

const inst = (id: string, def: ChildDef, x = 0, y = 0): Instance => ({ id, name: id, def, pos: { x, y } })
const iRef = (instanceId: string, portId: string): PinRef => ({ instanceId, portId })
const conn = (id: string, from: PinRef, to: PinRef): Connection => ({ id, from, to })

const INPUT_PORT: ChildDef = { kind: 'builtin', primitive: 'input-port' }
const OUTPUT_PORT: ChildDef = { kind: 'builtin', primitive: 'output-port' }

/** A full-adder-shaped template whose ports all resolve to width 1. */
function makeAdderTemplate(): CompositeDef {
  return {
    kind: 'composite',
    id: 'full-adder',
    name: 'full-adder',
    ports: [
      { id: 'in:0', name: 'A', direction: 'input', terminal: { instanceId: 'in', pinId: 'in:0' } },
      { id: 'in:1', name: 'B', direction: 'input', terminal: { instanceId: 'in', pinId: 'in:1' } },
      { id: 'in:2', name: 'Cin', direction: 'input', terminal: { instanceId: 'in', pinId: 'in:2' } },
      { id: 'out:0', name: 'Sum', direction: 'output', terminal: { instanceId: 'out', pinId: 'out:0' } },
      { id: 'out:1', name: 'Cout', direction: 'output', terminal: { instanceId: 'out', pinId: 'out:1' } },
    ],
    instances: [
      inst('in', INPUT_PORT, -100, 0),
      inst('out', OUTPUT_PORT, 200, 0),
      inst('g', { kind: 'fork', primitive: 'and', ports: [{ id: 'in:0', name: 'A', direction: 'input' }, { id: 'in:1', name: 'B', direction: 'input' }, { id: 'out:0', name: 'Y', direction: 'output' }] }, 0, 0),
      inst('buf', { kind: 'fork', primitive: 'buffer', ports: [{ id: 'in:0', name: 'A', direction: 'input' }, { id: 'out:0', name: 'Y', direction: 'output' }] }, 0, 120),
    ],
    connections: [
      conn('c1', iRef('in', 'in:0'), iRef('g', 'in:0')),
      conn('c2', iRef('in', 'in:1'), iRef('g', 'in:1')),
      conn('c3', iRef('g', 'out:0'), iRef('out', 'out:0')),
      conn('c4', iRef('in', 'in:2'), iRef('buf', 'in:0')),
      conn('c5', iRef('buf', 'out:0'), iRef('out', 'out:1')),
    ],
  }
}

const widthOf = (def: CompositeDef, portId: string): number | null => {
  const port = def.ports.find((p) => p.id === portId)!
  const ref = { instanceId: port.terminal!.instanceId, portId: port.terminal!.pinId }
  return resolvedPinWidth(def, def, ref)
}

describe('arrayComposite', () => {
  it('mirrors the template interface and materializes the copies', () => {
    const template = makeAdderTemplate()
    const arr = arrayComposite(template, 4, [], new Set())

    expect(arr.arrayConfig).toEqual({ count: 4, chains: [], orientation: 'horizontal', common: [] })
    expect(inputPorts(arr.ports).map((p) => p.id)).toEqual(['in:0', 'in:1', 'in:2'])
    expect(outputPorts(arr.ports).map((p) => p.id)).toEqual(['out:0', 'out:1'])
    expect(arr.ports.map((p) => p.name)).toEqual(['A', 'B', 'Cin', 'Sum', 'Cout'])

    // 4 copies + 2 port groups + 3 fan-outs + 1 fan-in = 10 instances.
    const copyDefs = arr.instances.filter((i) => i.id.startsWith('i')).map((i) => i.def)
    expect(copyDefs).toHaveLength(4)
    expect(copyDefs.every((d) => d.kind === 'composite')).toBe(true)
    // Copies carry the template's lineage uuid and get distinct ids.
    const ids = new Set(copyDefs.map((d) => (d as CompositeDef).id))
    expect(ids.size).toBe(4)
  })

  it('bundles non-chained ports into count-wide buses', () => {
    const arr = arrayComposite(makeAdderTemplate(), 4, [], new Set())
    expect(widthOf(arr, 'in:0')).toBe(4)
    expect(widthOf(arr, 'in:1')).toBe(4)
    expect(widthOf(arr, 'in:2')).toBe(4)
    expect(widthOf(arr, 'out:0')).toBe(4)
    expect(widthOf(arr, 'out:1')).toBe(4)
  })

  it('collapses chained ports to single wires and threads the carry', () => {
    const arr = arrayComposite(makeAdderTemplate(), 4, [{ from: 'out:1', to: 'in:2' }], new Set())

    expect(arr.arrayConfig?.chains).toEqual([{ from: 'out:1', to: 'in:2' }])
    expect(widthOf(arr, 'in:0')).toBe(4)
    expect(widthOf(arr, 'out:0')).toBe(4)
    expect(widthOf(arr, 'in:2')).toBe(1)
    expect(widthOf(arr, 'out:1')).toBe(1)

    // 3 inter-copy chain wires.
    const chains = arr.connections.filter(
      (c) => c.from.portId === 'out:1' && c.to.portId === 'in:2',
    )
    expect(chains).toHaveLength(3)
    expect(chains[0].from.instanceId).toBe('i0')
    expect(chains[0].to.instanceId).toBe('i1')
    expect(chains[2].from.instanceId).toBe('i2')
    expect(chains[2].to.instanceId).toBe('i3')
  })

  it('lays copies out vertically when asked', () => {
    const arr = arrayComposite(makeAdderTemplate(), 3, [], new Set(), 'vertical')
    expect(arr.arrayConfig?.orientation).toBe('vertical')
    const copies = arr.instances.filter((i) => i.id.startsWith('i'))
    // Vertical: x stays 0, y steps down (tighter than the horizontal step).
    expect(copies.map((c) => c.pos)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 80 },
      { x: 0, y: 160 },
    ])
  })

  it('keeps the left-to-right flow regardless of orientation', () => {
    const arr = arrayComposite(makeAdderTemplate(), 3, [], new Set(), 'vertical')
    const inputGroup = arr.instances.find((i) => i.def.kind === 'builtin' && i.def.primitive === 'input-port')!
    const outputGroup = arr.instances.find((i) => i.def.kind === 'builtin' && i.def.primitive === 'output-port')!
    const fanOuts = arr.instances.filter((i) => i.def.kind === 'fork' && i.def.primitive === 'fan-out')
    const fanIns = arr.instances.filter((i) => i.def.kind === 'fork' && i.def.primitive === 'fan-in')

    // Input port leftmost, output port rightmost, fans between them on the x axis.
    expect(inputGroup.pos.x).toBeLessThan(0)
    expect(outputGroup.pos.x).toBeGreaterThan(0)
    expect(fanOuts.every((f) => f.pos.x < 0)).toBe(true)
    expect(fanIns.every((f) => f.pos.x > 0)).toBe(true)
    // Copies sit at x=0, between the two columns.
    const copies = arr.instances.filter((i) => i.id.startsWith('i'))
    expect(copies.every((c) => c.pos.x === 0)).toBe(true)
    // Fan-outs are spread vertically (no overlap).
    expect(new Set(fanOuts.map((f) => f.pos.y)).size).toBe(fanOuts.length)
  })

  it('delivers common inputs as one shared wire to every copy', () => {
    const arr = arrayComposite(makeAdderTemplate(), 4, [], new Set(), 'horizontal', ['in:2'])

    expect(arr.arrayConfig?.common).toEqual(['in:2'])
    // The common input stays width 1; the others are count-wide buses.
    expect(widthOf(arr, 'in:0')).toBe(4)
    expect(widthOf(arr, 'in:1')).toBe(4)
    expect(widthOf(arr, 'in:2')).toBe(1)
    expect(widthOf(arr, 'out:0')).toBe(4)

    // No fan-out instance is created for the common input.
    expect(arr.instances.some((i) => i.id === 'f-fan-out-in-2')).toBe(false)

    // The common input is routed through a join-point (NODE) that fans out to the copies.
    const join = arr.instances.find((i) => i.def.kind === 'builtin' && i.def.primitive === 'join-point')!
    expect(join).toBeDefined()
    expect(join.id).toBe('j-in-2')
    // It sits in the fan-out column (same x, negative).
    expect(join.pos.x).toBeLessThan(0)

    const inputGroup = arr.instances.find((i) => i.def.kind === 'builtin' && i.def.primitive === 'input-port')!
    expect(
      arr.connections.some(
        (c) => c.from.instanceId === inputGroup.id && c.from.portId === 'in:2' && c.to.instanceId === join.id && c.to.portId === 'in:0',
      ),
    ).toBe(true)
    const fanWires = arr.connections.filter(
      (c) => c.from.instanceId === join.id && c.from.portId === 'out:0' && c.to.portId === 'in:2',
    )
    expect(fanWires).toHaveLength(4)
    expect(fanWires.map((c) => c.to.instanceId).sort()).toEqual(['i0', 'i1', 'i2', 'i3'])
  })

  it('survives serialization round-trip', () => {
    const arr = arrayComposite(makeAdderTemplate(), 4, [{ from: 'out:1', to: 'in:2' }], new Set(), 'vertical')
    const design = { version: 2, root: arr, library: {} }
    const parsed = parseDesign(serializeDesign(design))
    expect(parsed.root.arrayConfig).toEqual({ count: 4, chains: [{ from: 'out:1', to: 'in:2' }], orientation: 'vertical', common: [] })
    expect(widthOf(parsed.root, 'in:0')).toBe(4)
    expect(widthOf(parsed.root, 'in:2')).toBe(1)
  })

  it('preserves arrayConfig on clone', () => {
    const arr = arrayComposite(makeAdderTemplate(), 4, [{ from: 'out:1', to: 'in:2' }], new Set(), 'vertical', ['in:0'])
    const clone = cloneComposite(arr, new Set())
    expect(clone.arrayConfig).toEqual({ count: 4, chains: [{ from: 'out:1', to: 'in:2' }], orientation: 'vertical', common: ['in:0'] })
  })

  it('arrays a bus-width template into a wider bus', () => {
    const busT = busTemplate(4)
    const arr = arrayComposite(busT, 3, [], new Set())
    // 3 copies × 4-bit bus → 12-bit boundary bus.
    expect(widthOf(arr, 'in:0')).toBe(12)
    expect(widthOf(arr, 'out:0')).toBe(12)
  })

  it('nests: an array of arrays multiplies the widths', () => {
    const inner = arrayComposite(makeAdderTemplate(), 4, [{ from: 'out:1', to: 'in:2' }], new Set())
    const outer = arrayComposite(inner, 8, [{ from: 'out:1', to: 'in:2' }], new Set())

    // 8 copies of the 4-bit inner array → 32-bit buses; carry stays width 1.
    expect(widthOf(outer, 'in:0')).toBe(32)
    expect(widthOf(outer, 'out:0')).toBe(32)
    expect(widthOf(outer, 'in:2')).toBe(1)
    expect(widthOf(outer, 'out:1')).toBe(1)
  })
})

/** A template with a single 4-bit bus input/output (a `bus` primitive passthrough). */
function busTemplate(w: number): CompositeDef {
  return {
    kind: 'composite',
    id: 'bus-t',
    name: 'bus-t',
    ports: [
      { id: 'in:0', name: 'A', direction: 'input', terminal: { instanceId: 'in', pinId: 'in:0' } },
      { id: 'out:0', name: 'Y', direction: 'output', terminal: { instanceId: 'out', pinId: 'out:0' } },
    ],
    instances: [
      inst('in', INPUT_PORT, -100, 0),
      { id: 'b', name: 'b', def: { kind: 'fork', primitive: 'bus', ports: [{ id: 'in:0', name: 'A', direction: 'input' }, { id: 'out:0', name: 'Y', direction: 'output' }] }, pos: { x: 0, y: 0 }, props: { lanes: w } },
      inst('out', OUTPUT_PORT, 100, 0),
    ],
    connections: [
      conn('c1', iRef('in', 'in:0'), iRef('b', 'in:0')),
      conn('c2', iRef('b', 'out:0'), iRef('out', 'out:0')),
    ],
  }
}
