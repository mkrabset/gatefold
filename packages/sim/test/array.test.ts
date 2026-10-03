import { describe, expect, it } from 'vitest'
import type { ChildDef, CompositeDef, Connection, Instance, PinRef } from '@gatefold/model'
import { arrayComposite, builtinOf } from '@gatefold/model'
import { Simulation } from '../src/engine'

const iref = (instanceId: string, portId: string): PinRef => ({ instanceId, portId })
const conn = (id: string, from: PinRef, to: PinRef): Connection => ({ id, from, to })
const inst = (id: string, def: ChildDef): Instance => ({ id, name: id, def, pos: { x: 0, y: 0 } })

const INPUT_PORT: ChildDef = builtinOf('input-port')
const OUTPUT_PORT: ChildDef = builtinOf('output-port')

const xor2: ChildDef = {
  kind: 'fork',
  primitive: 'xor',
  ports: [
    { id: 'in:0', name: 'A', direction: 'input' },
    { id: 'in:1', name: 'B', direction: 'input' },
    { id: 'out:0', name: 'Y', direction: 'output' },
  ],
}
const and2: ChildDef = {
  kind: 'fork',
  primitive: 'and',
  ports: [
    { id: 'in:0', name: 'A', direction: 'input' },
    { id: 'in:1', name: 'B', direction: 'input' },
    { id: 'out:0', name: 'Y', direction: 'output' },
  ],
}
const or2: ChildDef = {
  kind: 'fork',
  primitive: 'or',
  ports: [
    { id: 'in:0', name: 'A', direction: 'input' },
    { id: 'in:1', name: 'B', direction: 'input' },
    { id: 'out:0', name: 'Y', direction: 'output' },
  ],
}
const not1: ChildDef = {
  kind: 'fork',
  primitive: 'buffer',
  ports: [
    { id: 'in:0', name: 'A', direction: 'input' },
    { id: 'out:0', name: 'Y', direction: 'output', inverted: true },
  ],
}

/** A real one-bit full-adder: Sum = A⊕B⊕Cin, Cout = (A·B) | (Cin·(A⊕B)). */
function makeFullAdder(): CompositeDef {
  return {
    kind: 'composite',
    id: 'fa',
    name: 'fa',
    ports: [
      { id: 'in:0', name: 'A', direction: 'input', terminal: { instanceId: 'in', pinId: 'in:0' } },
      { id: 'in:1', name: 'B', direction: 'input', terminal: { instanceId: 'in', pinId: 'in:1' } },
      { id: 'in:2', name: 'Cin', direction: 'input', terminal: { instanceId: 'in', pinId: 'in:2' } },
      { id: 'out:0', name: 'Sum', direction: 'output', terminal: { instanceId: 'out', pinId: 'out:0' } },
      { id: 'out:1', name: 'Cout', direction: 'output', terminal: { instanceId: 'out', pinId: 'out:1' } },
    ],
    instances: [
      inst('in', INPUT_PORT),
      inst('out', OUTPUT_PORT),
      inst('x1', xor2),
      inst('x2', xor2),
      inst('a1', and2),
      inst('a2', and2),
      inst('o1', or2),
    ],
    connections: [
      conn('c1', iref('in', 'in:0'), iref('x1', 'in:0')),
      conn('c2', iref('in', 'in:1'), iref('x1', 'in:1')),
      conn('c3', iref('x1', 'out:0'), iref('x2', 'in:0')),
      conn('c4', iref('in', 'in:2'), iref('x2', 'in:1')),
      conn('c5', iref('in', 'in:0'), iref('a1', 'in:0')),
      conn('c6', iref('in', 'in:1'), iref('a1', 'in:1')),
      conn('c7', iref('in', 'in:2'), iref('a2', 'in:0')),
      conn('c8', iref('x1', 'out:0'), iref('a2', 'in:1')),
      conn('c9', iref('x2', 'out:0'), iref('out', 'out:0')),
      conn('c10', iref('a1', 'out:0'), iref('o1', 'in:0')),
      conn('c11', iref('a2', 'out:0'), iref('o1', 'in:1')),
      conn('c12', iref('o1', 'out:0'), iref('out', 'out:1')),
    ],
  }
}

const switchBus: ChildDef = { kind: 'fork', primitive: 'switch-array', ports: [{ id: 'out:0', name: 'BUS', direction: 'output' }] }
const switchBit: ChildDef = { kind: 'fork', primitive: 'switch-array', ports: [{ id: 'out:0', name: 'Y', direction: 'output' }] }

function rippleDesign(n: number, chains: { from: string; to: string }[]): { sim: Simulation; ids: { a: string; b: string; cin: string; arr: string } } {
  const arr = arrayComposite(makeFullAdder(), n, chains, new Set())
  const instances: Instance[] = [
    inst('arr', arr),
    inst('swA', switchBus),
    inst('swB', switchBus),
    inst('swCin', switchBit),
  ]
  const connections: Connection[] = [
    conn('ca', iref('swA', 'out:0'), iref('arr', 'in:0')),
    conn('cb', iref('swB', 'out:0'), iref('arr', 'in:1')),
    conn('cc', iref('swCin', 'out:0'), iref('arr', 'in:2')),
  ]
  const main: CompositeDef = { id: 'main', name: 'main', kind: 'composite', ports: [], instances, connections }
  const design = { version: 2, root: main, library: {} }
  const sim = new Simulation(design)
  sim.step()
  return { sim, ids: { a: 'swA', b: 'swB', cin: 'swCin', arr: 'arr' } }
}

describe('array ripple adder', () => {
  it('adds two 4-bit numbers with a carry chain', () => {
    const { sim, ids } = rippleDesign(4, [{ from: 'out:1', to: 'in:2' }])
    // 3 + 5 = 8 (no carry out). Lanes are LSB-first.
    sim.setSwitchLanes(ids.a, [1, 1, 0, 0]) // 0b0011
    sim.setSwitchLanes(ids.b, [1, 0, 1, 0]) // 0b0101
    sim.setSwitchLanes(ids.cin, [0])
    sim.step()

    expect(sim.signalOf(ids.arr, 'out:0')).toEqual([0, 0, 0, 1]) // 8
    expect(sim.signalOf(ids.arr, 'out:1')).toEqual([0]) // no carry
  })

  it('propagates a carry across every stage', () => {
    const { sim, ids } = rippleDesign(4, [{ from: 'out:1', to: 'in:2' }])
    // 15 + 1 = 16 → sum 0, carry out 1.
    sim.setSwitchLanes(ids.a, [1, 1, 1, 1]) // 0b1111
    sim.setSwitchLanes(ids.b, [1, 0, 0, 0]) // 0b0001
    sim.setSwitchLanes(ids.cin, [0])
    sim.step()

    expect(sim.signalOf(ids.arr, 'out:0')).toEqual([0, 0, 0, 0])
    expect(sim.signalOf(ids.arr, 'out:1')).toEqual([1])
  })

  it('scales to 8 bits', () => {
    const { sim, ids } = rippleDesign(8, [{ from: 'out:1', to: 'in:2' }])
    // 0x55 + 0x01 = 0x56.
    sim.setSwitchLanes(ids.a, [1, 0, 1, 0, 1, 0, 1, 0]) // 0b01010101
    sim.setSwitchLanes(ids.b, [1, 0, 0, 0, 0, 0, 0, 0]) // 0b00000001
    sim.setSwitchLanes(ids.cin, [0])
    sim.step()

    expect(sim.signalOf(ids.arr, 'out:0')).toEqual([0, 1, 1, 0, 1, 0, 1, 0]) // 0b01010110
    expect(sim.signalOf(ids.arr, 'out:1')).toEqual([0])
  })
})

/** A 2-to-1 mux: Y = (A·~Sel) | (B·Sel). */
function makeMux2x1(): CompositeDef {
  return {
    kind: 'composite',
    id: 'mux',
    name: 'mux',
    ports: [
      { id: 'in:0', name: 'A', direction: 'input', terminal: { instanceId: 'in', pinId: 'in:0' } },
      { id: 'in:1', name: 'B', direction: 'input', terminal: { instanceId: 'in', pinId: 'in:1' } },
      { id: 'in:2', name: 'Sel', direction: 'input', terminal: { instanceId: 'in', pinId: 'in:2' } },
      { id: 'out:0', name: 'Y', direction: 'output', terminal: { instanceId: 'out', pinId: 'out:0' } },
    ],
    instances: [
      inst('in', INPUT_PORT),
      inst('out', OUTPUT_PORT),
      inst('n', not1),
      inst('a1', and2),
      inst('a2', and2),
      inst('o', or2),
    ],
    connections: [
      conn('c1', iref('in', 'in:0'), iref('a1', 'in:0')),
      conn('c2', iref('in', 'in:2'), iref('n', 'in:0')),
      conn('c3', iref('n', 'out:0'), iref('a1', 'in:1')),
      conn('c4', iref('in', 'in:1'), iref('a2', 'in:0')),
      conn('c5', iref('in', 'in:2'), iref('a2', 'in:1')),
      conn('c6', iref('a1', 'out:0'), iref('o', 'in:0')),
      conn('c7', iref('a2', 'out:0'), iref('o', 'in:1')),
      conn('c8', iref('o', 'out:0'), iref('out', 'out:0')),
    ],
  }
}

describe('array common input (word mux)', () => {
  function muxDesign(n: number) {
    const arr = arrayComposite(makeMux2x1(), n, [], new Set(), 'horizontal', ['in:2'])
    const instances: Instance[] = [inst('arr', arr), inst('swA', switchBus), inst('swB', switchBus), inst('swSel', switchBit)]
    const connections: Connection[] = [
      conn('ca', iref('swA', 'out:0'), iref('arr', 'in:0')),
      conn('cb', iref('swB', 'out:0'), iref('arr', 'in:1')),
      conn('cs', iref('swSel', 'out:0'), iref('arr', 'in:2')),
    ]
    const main: CompositeDef = { id: 'main', name: 'main', kind: 'composite', ports: [], instances, connections }
    const sim = new Simulation({ version: 2, root: main, library: {} })
    sim.step()
    return sim
  }

  it('shares the selection signal across all eight muxes', () => {
    const sim = muxDesign(8)
    // A = 0x00, B = 0xFF. Sel selects between them.
    sim.setSwitchLanes('swA', [0, 0, 0, 0, 0, 0, 0, 0])
    sim.setSwitchLanes('swB', [1, 1, 1, 1, 1, 1, 1, 1])

    sim.setSwitchLanes('swSel', [1])
    sim.step()
    expect(sim.signalOf('arr', 'out:0')).toEqual([1, 1, 1, 1, 1, 1, 1, 1]) // all B

    sim.setSwitchLanes('swSel', [0])
    sim.step()
    expect(sim.signalOf('arr', 'out:0')).toEqual([0, 0, 0, 0, 0, 0, 0, 0]) // all A
  })
})
