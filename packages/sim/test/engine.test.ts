import { describe, expect, it } from 'vitest'
import type { ChildDef, CompositeDef, Design, Instance, PinRef, PrimitiveKind } from '@gatefold/model'
import { builtinOf, forkOf } from '@gatefold/model'
import { Simulation } from '../src/engine'
import { DEFAULT_CONFIG } from '../src/config'

const iref = (instanceId: string, portId: string): PinRef => ({ instanceId, portId })
const conn = (id: string, from: PinRef, to: PinRef) => ({ id, from, to })

const inst = (id: string, def: ChildDef | string, props?: Instance['props']): Instance => {
  const d: ChildDef = typeof def === 'string' ? forkOf(def as PrimitiveKind) : def
  return { id, name: id, def: d, pos: { x: 0, y: 0 }, ...(props ? { props } : {}) }
}

const clk = (id: string, props?: Instance['props']): Instance => inst(id, 'clock', props)
const INPUT_PORT: ChildDef = builtinOf('input-port')
const OUTPUT_PORT: ChildDef = builtinOf('output-port')

function mkDesign(instances: Instance[], connections: CompositeDef['connections']): Design {
  const main: CompositeDef = { id: 'main', name: 'main', kind: 'composite', ports: [], instances, connections }
  return { version: 2, root: main, library: {} }
}

/** A single clock (period 1000 ps) driving a chain of `n` buffers (n×100 ps path delay). */
function timingDesign(n: number): Design {
  const instances: Instance[] = [clk('clk', { period: 1000 })]
  const connections: CompositeDef['connections'] = []
  let prev: PinRef = iref('clk', 'out:0')
  for (let i = 0; i < n; i++) {
    instances.push(inst(`b${i}`, 'buffer'))
    connections.push(conn(`c${i}`, prev, iref(`b${i}`, 'in:0')))
    prev = iref(`b${i}`, 'out:0')
  }
  return mkDesign(instances, connections)
}

const nor: ChildDef = {
  kind: 'fork',
  primitive: 'or',
  ports: [
    { id: 'in:0', name: 'A', direction: 'input' },
    { id: 'in:1', name: 'B', direction: 'input' },
    { id: 'out:0', name: 'Y', direction: 'output', inverted: true },
  ],
}
const and3: ChildDef = {
  kind: 'fork',
  primitive: 'and',
  ports: [
    { id: 'in:0', name: 'A', direction: 'input' },
    { id: 'in:1', name: 'B', direction: 'input' },
    { id: 'in:2', name: 'C', direction: 'input' },
    { id: 'out:0', name: 'Y', direction: 'output' },
  ],
}
const nand2: ChildDef = {
  kind: 'fork',
  primitive: 'and',
  ports: [
    { id: 'in:0', name: 'A', direction: 'input' },
    { id: 'in:1', name: 'B', direction: 'input' },
    { id: 'out:0', name: 'Y', direction: 'output', inverted: true },
  ],
}
const nand3: ChildDef = {
  kind: 'fork',
  primitive: 'and',
  ports: [
    { id: 'in:0', name: 'A', direction: 'input' },
    { id: 'in:1', name: 'B', direction: 'input' },
    { id: 'in:2', name: 'C', direction: 'input' },
    { id: 'out:0', name: 'Y', direction: 'output', inverted: true },
  ],
}
const fanIn4: ChildDef = {
  kind: 'fork',
  primitive: 'fan-in',
  ports: [
    { id: 'in:0', name: 'A', direction: 'input' },
    { id: 'in:1', name: 'B', direction: 'input' },
    { id: 'in:2', name: 'C', direction: 'input' },
    { id: 'in:3', name: 'D', direction: 'input' },
    { id: 'out:0', name: 'BUS', direction: 'output' },
  ],
}
const switchArray4: ChildDef = {
  kind: 'fork',
  primitive: 'switch-array',
  ports: [
    { id: 'out:0', name: 'Y0', direction: 'output' },
    { id: 'out:1', name: 'Y1', direction: 'output' },
    { id: 'out:2', name: 'Y2', direction: 'output' },
    { id: 'out:3', name: 'Y3', direction: 'output' },
  ],
}
const switchArray3: ChildDef = {
  kind: 'fork',
  primitive: 'switch-array',
  ports: [
    { id: 'out:0', name: 'Y0', direction: 'output' },
    { id: 'out:1', name: 'Y1', direction: 'output' },
    { id: 'out:2', name: 'Y2', direction: 'output' },
  ],
}
const switchBus: ChildDef = { kind: 'fork', primitive: 'switch-array', ports: [{ id: 'out:0', name: 'BUS', direction: 'output' }] }
const switchBusInv: ChildDef = { kind: 'fork', primitive: 'switch-array', ports: [{ id: 'out:0', name: 'BUS', direction: 'output', inverted: true }] }
const fanOut4: ChildDef = {
  kind: 'fork',
  primitive: 'fan-out',
  ports: [
    { id: 'in:0', name: 'BUS', direction: 'input' },
    { id: 'out:0', name: 'Y1', direction: 'output' },
    { id: 'out:1', name: 'Y2', direction: 'output' },
    { id: 'out:2', name: 'Y3', direction: 'output' },
    { id: 'out:3', name: 'Y4', direction: 'output' },
  ],
}
const bus2: ChildDef = {
  kind: 'fork',
  primitive: 'bus',
  ports: [
    { id: 'in:0', name: 'A', direction: 'input' },
    { id: 'out:0', name: 'Y', direction: 'output' },
  ],
}

describe('Simulation engine', () => {
  it('propagates combinational logic from switches', () => {
    const sim = new Simulation(
      mkDesign(
        [inst('a', 'switch-array'), inst('b', 'switch-array'), inst('g', 'and')],
        [conn('c1', iref('a', 'out:0'), iref('g', 'in:0')), conn('c2', iref('b', 'out:0'), iref('g', 'in:1'))],
      ),
    )
    sim.setSwitch('a', 1)
    sim.setSwitch('b', 1)
    sim.step()
    expect(sim.signal('g', 'out:0')).toBe(1)
  })

  it('fans a single wire out through a NODE join-point', () => {
    const sim = new Simulation(
      mkDesign(
        [inst('sw', 'switch-array'), inst('j', 'join-point'), inst('l1', 'led-array'), inst('l2', 'led-array')],
        [
          conn('c1', iref('sw', 'out:0'), iref('j', 'in:0')),
          conn('c2', iref('j', 'out:0'), iref('l1', 'in:0')),
          conn('c3', iref('j', 'out:0'), iref('l2', 'in:0')),
        ],
      ),
    )
    sim.setSwitch('sw', 1)
    sim.step()
    expect(sim.signal('j', 'out:0')).toBe(1)
    expect(sim.signal('l1', 'in:0')).toBe(1)
    expect(sim.signal('l2', 'in:0')).toBe(1)

    sim.setSwitch('sw', 0)
    sim.step()
    expect(sim.signal('j', 'out:0')).toBe(0)
    expect(sim.signal('l1', 'in:0')).toBe(0)
    expect(sim.signal('l2', 'in:0')).toBe(0)
  })

  it('propagates unknown through an unconnected input', () => {
    const sim = new Simulation(
      mkDesign([inst('a', 'switch-array'), inst('g', 'and')], [conn('c1', iref('a', 'out:0'), iref('g', 'in:0'))]),
    )
    sim.setSwitch('a', 1)
    sim.step()
    expect(sim.signal('g', 'out:0')).toBe('x')
  })

  it('settles a NOR SR latch with set/reset/hold', () => {
    const sim = new Simulation(
      mkDesign(
        [inst('s', 'switch-array'), inst('r', 'switch-array'), inst('o1', 'or'), inst('n1', 'not'), inst('o2', 'or'), inst('n2', 'not')],
        [
          conn('c1', iref('r', 'out:0'), iref('o1', 'in:0')),
          conn('c2', iref('n2', 'out:0'), iref('o1', 'in:1')),
          conn('c3', iref('o1', 'out:0'), iref('n1', 'in:0')),
          conn('c4', iref('s', 'out:0'), iref('o2', 'in:0')),
          conn('c5', iref('n1', 'out:0'), iref('o2', 'in:1')),
          conn('c6', iref('o2', 'out:0'), iref('n2', 'in:0')),
        ],
      ),
    )

    expect(sim.signal('n1', 'out:0')).not.toBe('x')
    expect(sim.signal('n2', 'out:0')).not.toBe('x')
    expect(sim.signal('n2', 'out:0')).not.toBe(sim.signal('n1', 'out:0'))

    sim.setSwitch('s', 1)
    sim.step()
    expect(sim.signal('n1', 'out:0')).toBe(1)
    expect(sim.signal('n2', 'out:0')).toBe(0)

    sim.setSwitch('s', 0)
    sim.step()
    expect(sim.signal('n1', 'out:0')).toBe(1)

    sim.setSwitch('r', 1)
    sim.step()
    expect(sim.signal('n1', 'out:0')).toBe(0)
    expect(sim.signal('n2', 'out:0')).toBe(1)

    sim.setSwitch('r', 0)
    sim.step()
    expect(sim.signal('n1', 'out:0')).toBe(0)
  })

  it('detects a gate-level oscillator and marks it unknown', () => {
    const sim = new Simulation(
      mkDesign(
        [inst('en', 'switch-array'), inst('a', 'and'), inst('n', 'not')],
        [
          conn('c1', iref('en', 'out:0'), iref('a', 'in:0')),
          conn('c2', iref('n', 'out:0'), iref('a', 'in:1')),
          conn('c3', iref('a', 'out:0'), iref('n', 'in:0')),
        ],
      ),
    )
    sim.setSwitch('en', 0)
    sim.step()
    expect(sim.signal('a', 'out:0')).toBe(0)

    sim.setSwitch('en', 1)
    sim.step()
    expect(sim.signal('a', 'out:0')).toBe('x')
  })

  it('powers on and sets/resets a gated JK flip-flop (2 NOR + 2 AND)', () => {
    const sim = new Simulation(
      mkDesign(
        [
          inst('j', 'switch-array'),
          inst('k', 'switch-array'),
          inst('clk', 'switch-array'),
          inst('a1', and3),
          inst('a2', and3),
          inst('n1', nor),
          inst('n2', nor),
        ],
        [
          conn('c1', iref('j', 'out:0'), iref('a1', 'in:0')),
          conn('c2', iref('n2', 'out:0'), iref('a1', 'in:1')),
          conn('c3', iref('clk', 'out:0'), iref('a1', 'in:2')),
          conn('c4', iref('k', 'out:0'), iref('a2', 'in:0')),
          conn('c5', iref('n1', 'out:0'), iref('a2', 'in:1')),
          conn('c6', iref('clk', 'out:0'), iref('a2', 'in:2')),
          conn('c7', iref('a2', 'out:0'), iref('n1', 'in:0')),
          conn('c8', iref('n2', 'out:0'), iref('n1', 'in:1')),
          conn('c9', iref('a1', 'out:0'), iref('n2', 'in:0')),
          conn('c10', iref('n1', 'out:0'), iref('n2', 'in:1')),
        ],
      ),
    )

    expect(sim.signal('n1', 'out:0')).not.toBe('x')
    expect(sim.signal('n2', 'out:0')).not.toBe('x')
    expect(sim.signal('n1', 'out:0')).not.toBe(sim.signal('n2', 'out:0'))

    sim.setSwitch('j', 1)
    sim.setSwitch('clk', 1)
    sim.step()
    expect(sim.signal('n1', 'out:0')).toBe(1)
    expect(sim.signal('n2', 'out:0')).toBe(0)

    sim.setSwitch('j', 0)
    sim.setSwitch('k', 1)
    sim.step()
    expect(sim.signal('n1', 'out:0')).toBe(0)
    expect(sim.signal('n2', 'out:0')).toBe(1)
  })

  it('edge-triggers a master-slave JK flip-flop (8 NAND + NOT)', () => {
    const sim = new Simulation(
      mkDesign(
        [
          inst('j', 'switch-array'),
          inst('k', 'switch-array'),
          inst('clk', 'switch-array'),
          inst('notClk', 'not'),
          inst('m1', nand3),
          inst('m2', nand3),
          inst('m3', nand2),
          inst('m4', nand2),
          inst('s1', nand2),
          inst('s2', nand2),
          inst('s3', nand2),
          inst('s4', nand2),
        ],
        [
          conn('c1', iref('j', 'out:0'), iref('m1', 'in:0')),
          conn('c2', iref('s4', 'out:0'), iref('m1', 'in:1')),
          conn('c3', iref('clk', 'out:0'), iref('m1', 'in:2')),
          conn('c4', iref('k', 'out:0'), iref('m2', 'in:0')),
          conn('c5', iref('s3', 'out:0'), iref('m2', 'in:1')),
          conn('c6', iref('clk', 'out:0'), iref('m2', 'in:2')),
          conn('c7', iref('m1', 'out:0'), iref('m3', 'in:0')),
          conn('c8', iref('m4', 'out:0'), iref('m3', 'in:1')),
          conn('c9', iref('m2', 'out:0'), iref('m4', 'in:0')),
          conn('c10', iref('m3', 'out:0'), iref('m4', 'in:1')),
          conn('c11', iref('clk', 'out:0'), iref('notClk', 'in:0')),
          conn('c12', iref('m3', 'out:0'), iref('s1', 'in:0')),
          conn('c13', iref('notClk', 'out:0'), iref('s1', 'in:1')),
          conn('c14', iref('m4', 'out:0'), iref('s2', 'in:0')),
          conn('c15', iref('notClk', 'out:0'), iref('s2', 'in:1')),
          conn('c16', iref('s1', 'out:0'), iref('s3', 'in:0')),
          conn('c17', iref('s4', 'out:0'), iref('s3', 'in:1')),
          conn('c18', iref('s2', 'out:0'), iref('s4', 'in:0')),
          conn('c19', iref('s3', 'out:0'), iref('s4', 'in:1')),
        ],
      ),
    )

    const q0 = sim.signal('s3', 'out:0')
    expect(q0).not.toBe('x')
    expect(sim.signal('s4', 'out:0')).not.toBe('x')
    expect(sim.signal('s4', 'out:0')).not.toBe(q0)

    sim.setSwitch('j', 1)
    sim.step()
    expect(sim.signal('s3', 'out:0')).toBe(q0)

    sim.setSwitch('clk', 1)
    sim.step()
    expect(sim.signal('s3', 'out:0')).toBe(q0)

    sim.setSwitch('clk', 0)
    sim.step()
    expect(sim.signal('s3', 'out:0')).toBe(1)

    sim.setSwitch('j', 0)
    sim.setSwitch('k', 1)
    sim.setSwitch('clk', 1)
    sim.step()
    sim.setSwitch('clk', 0)
    sim.step()
    expect(sim.signal('s3', 'out:0')).toBe(0)

    sim.setSwitch('j', 1)
    sim.setSwitch('clk', 1)
    sim.step()
    sim.setSwitch('clk', 0)
    sim.step()
    expect(sim.signal('s3', 'out:0')).toBe(1)

    sim.setSwitch('clk', 1)
    sim.step()
    sim.setSwitch('clk', 0)
    sim.step()
    expect(sim.signal('s3', 'out:0')).toBe(0)
  })

  it('propagates buses through fan-in and bus-split', () => {
    const sim = new Simulation(
      mkDesign(
        [inst('s0', 'switch-array'), inst('s1', 'switch-array'), inst('s2', 'switch-array'), inst('s3', 'switch-array'), inst('fi', fanIn4), inst('bs', 'bus-split')],
        [
          conn('c0', iref('s0', 'out:0'), iref('fi', 'in:0')),
          conn('c1', iref('s1', 'out:0'), iref('fi', 'in:1')),
          conn('c2', iref('s2', 'out:0'), iref('fi', 'in:2')),
          conn('c3', iref('s3', 'out:0'), iref('fi', 'in:3')),
          conn('c4', iref('fi', 'out:0'), iref('bs', 'in:0')),
        ],
      ),
    )
    sim.setSwitch('s0', 1)
    sim.setSwitch('s1', 0)
    sim.setSwitch('s2', 1)
    sim.setSwitch('s3', 0)
    sim.step()
    expect(sim.signalOf('bs', 'out:0')).toEqual([1, 0])
    expect(sim.signalOf('bs', 'out:1')).toEqual([1, 0])
  })

  it('produces a clock square wave over time', () => {
    const sim = new Simulation(
      mkDesign([clk('clk', { period: 1000 }), inst('l', 'led-array')], [conn('c1', iref('clk', 'out:0'), iref('l', 'in:0'))]),
    )
    expect(sim.signal('l', 'in:0')).toBe(1)
    sim.advanceTo(500)
    expect(sim.signal('l', 'in:0')).toBe(0)
    sim.advanceTo(1000)
    expect(sim.signal('l', 'in:0')).toBe(1)
  })

  it('steps one clock edge at a time in clock-edge mode', () => {
    const sim = new Simulation(
      mkDesign([clk('clk', { period: 1000 }), inst('l', 'led-array')], [conn('c1', iref('clk', 'out:0'), iref('l', 'in:0'))]),
      { ...DEFAULT_CONFIG, stepMode: 'clock-edge' },
    )
    expect(sim.signal('l', 'in:0')).toBe(1)
    sim.step()
    expect(sim.signal('l', 'in:0')).toBe(0)
    sim.step()
    expect(sim.signal('l', 'in:0')).toBe(1)
    sim.step()
    expect(sim.signal('l', 'in:0')).toBe(0)
  })

  it('advances through intermediate clock edges (event-driven)', () => {
    const sim = new Simulation(
      mkDesign([clk('clk', { period: 1000 }), inst('l', 'led-array')], [conn('c1', iref('clk', 'out:0'), iref('l', 'in:0'))]),
    )
    expect(sim.signal('l', 'in:0')).toBe(1)
    sim.advanceTo(1200)
    expect(sim.signal('l', 'in:0')).toBe(1)
    sim.advanceTo(1700)
    expect(sim.signal('l', 'in:0')).toBe(0)
  })

  it('samples a DFF with a short-period clock without aliasing', () => {
    const sim = new Simulation(
      mkDesign(
        [inst('d', 'switch-array'), clk('clk', { period: 1000 }), inst('f', 'dff')],
        [
          conn('c1', iref('d', 'out:0'), iref('f', 'in:0')),
          conn('c2', iref('clk', 'out:0'), iref('f', 'in:1')),
        ],
      ),
    )
    sim.setSwitch('d', 1)
    sim.step()
    expect(sim.signal('f', 'out:0')).toBe(0)
    sim.advanceTo(1000)
    sim.step()
    expect(sim.signal('f', 'out:0')).toBe(1)
  })

  it('resolves signals on port-group and composite-boundary pins', () => {
    const comp: ChildDef = {
      kind: 'composite',
      id: 'comp',
      name: 'comp',
      ports: [
        { id: 'in:0', name: 'A', direction: 'input', terminal: { instanceId: 'ci', pinId: 'in:0' } },
        { id: 'out:0', name: 'Y', direction: 'output', terminal: { instanceId: 'co', pinId: 'out:0' } },
      ],
      instances: [
        { id: 'ci', name: '', def: INPUT_PORT, pos: { x: 0, y: 0 } },
        { id: 'b', name: 'b', def: forkOf('buffer'), pos: { x: 60, y: 0 } },
        { id: 'co', name: '', def: OUTPUT_PORT, pos: { x: 120, y: 0 } },
      ],
      connections: [
        { id: 'c1', from: iref('ci', 'in:0'), to: iref('b', 'in:0') },
        { id: 'c2', from: iref('b', 'out:0'), to: iref('co', 'out:0') },
      ],
    }
    const sim = new Simulation(
      mkDesign([inst('sw', 'switch-array'), inst('comp', comp)], [conn('w', iref('sw', 'out:0'), iref('comp', 'in:0'))]),
    )

    expect(sim.signal('comp', 'in:0')).toBe(0)
    expect(sim.signal('comp.ci', 'in:0')).toBe(0)
    expect(sim.signal('comp.b', 'out:0')).toBe(0)
    expect(sim.signal('comp.co', 'out:0')).toBe(0)
    expect(sim.signal('comp', 'out:0')).toBe(0)

    sim.setSwitch('sw', 1)
    sim.step()
    expect(sim.signal('comp', 'in:0')).toBe(1)
    expect(sim.signal('comp.ci', 'in:0')).toBe(1)
    expect(sim.signal('comp.b', 'out:0')).toBe(1)
    expect(sim.signal('comp.co', 'out:0')).toBe(1)
    expect(sim.signal('comp', 'out:0')).toBe(1)
  })

  it('inverts a composite input terminal at the boundary', () => {
    const comp: ChildDef = {
      kind: 'composite',
      id: 'comp',
      name: 'comp',
      ports: [
        { id: 'in:0', name: 'A', direction: 'input', terminal: { instanceId: 'ci', pinId: 'in:0' }, inverted: true },
        { id: 'in:1', name: 'B', direction: 'input', terminal: { instanceId: 'ci', pinId: 'in:1' } },
        { id: 'out:0', name: 'Y', direction: 'output', terminal: { instanceId: 'co', pinId: 'out:0' } },
      ],
      instances: [
        { id: 'ci', name: '', def: INPUT_PORT, pos: { x: 0, y: 0 } },
        { id: 'g', name: 'g', def: forkOf('and'), pos: { x: 60, y: 0 } },
        { id: 'co', name: '', def: OUTPUT_PORT, pos: { x: 120, y: 0 } },
      ],
      connections: [
        { id: 'c1', from: iref('ci', 'in:0'), to: iref('g', 'in:0') },
        { id: 'c2', from: iref('ci', 'in:1'), to: iref('g', 'in:1') },
        { id: 'c3', from: iref('g', 'out:0'), to: iref('co', 'out:0') },
      ],
    }
    const sim = new Simulation(
      mkDesign(
        [inst('sw', 'switch-array'), inst('comp', comp)],
        [
          conn('w1', iref('sw', 'out:0'), iref('comp', 'in:0')),
          conn('w2', iref('sw', 'out:0'), iref('comp', 'in:1')),
        ],
      ),
    )

    expect(sim.signal('comp', 'in:0')).toBe(0)
    expect(sim.signal('comp.ci', 'in:0')).toBe(1)
    expect(sim.signal('comp', 'out:0')).toBe(0)

    sim.setSwitch('sw', 1)
    sim.step()
    expect(sim.signal('comp', 'in:0')).toBe(1)
    expect(sim.signal('comp.ci', 'in:0')).toBe(0)
    expect(sim.signal('comp', 'out:0')).toBe(0)
  })

  it('inverts a composite output terminal at the boundary', () => {
    const comp: ChildDef = {
      kind: 'composite',
      id: 'comp',
      name: 'comp',
      ports: [
        { id: 'in:0', name: 'A', direction: 'input', terminal: { instanceId: 'ci', pinId: 'in:0' } },
        { id: 'out:0', name: 'Y', direction: 'output', terminal: { instanceId: 'co', pinId: 'out:0' }, inverted: true },
      ],
      instances: [
        { id: 'ci', name: '', def: INPUT_PORT, pos: { x: 0, y: 0 } },
        { id: 'b', name: 'b', def: forkOf('buffer'), pos: { x: 60, y: 0 } },
        { id: 'co', name: '', def: OUTPUT_PORT, pos: { x: 120, y: 0 } },
      ],
      connections: [
        { id: 'c1', from: iref('ci', 'in:0'), to: iref('b', 'in:0') },
        { id: 'c2', from: iref('b', 'out:0'), to: iref('co', 'out:0') },
      ],
    }
    const sim = new Simulation(
      mkDesign([inst('sw', 'switch-array'), inst('comp', comp)], [conn('w', iref('sw', 'out:0'), iref('comp', 'in:0'))]),
    )

    expect(sim.signal('comp.co', 'out:0')).toBe(0)
    expect(sim.signal('comp', 'out:0')).toBe(1)

    sim.setSwitch('sw', 1)
    sim.step()
    expect(sim.signal('comp.co', 'out:0')).toBe(1)
    expect(sim.signal('comp', 'out:0')).toBe(0)
  })

  it('toggles individual lanes of a switch-array in WIRE mode', () => {
    const sim = new Simulation(mkDesign([inst('sa', switchArray4)], []))
    expect(sim.signal('sa', 'out:0')).toBe(0)
    sim.toggleSwitch('sa', 2)
    sim.step()
    expect(sim.signal('sa', 'out:2')).toBe(1)
    expect(sim.signal('sa', 'out:0')).toBe(0)
    expect(sim.signal('sa', 'out:1')).toBe(0)
  })

  it('powers on switch-array lanes to their initial value', () => {
    const sim = new Simulation(
      mkDesign([inst('sa', switchArray3, { initialValue: true })], []),
    )
    expect(sim.signal('sa', 'out:0')).toBe(1)
    expect(sim.signal('sa', 'out:1')).toBe(1)
    expect(sim.signal('sa', 'out:2')).toBe(1)

    sim.toggleSwitch('sa', 1)
    sim.step()
    expect(sim.signal('sa', 'out:1')).toBe(0)
    expect(sim.signal('sa', 'out:0')).toBe(1)
    expect(sim.signal('sa', 'out:2')).toBe(1)
  })

  it('adopts the connected bus width and toggles lanes of a switch-array in BUS mode', () => {
    const sim = new Simulation(
      mkDesign([inst('sa', switchBus), inst('fo', fanOut4)], [conn('c1', iref('sa', 'out:0'), iref('fo', 'in:0'))]),
    )
    expect(sim.signalOf('sa', 'out:0')).toEqual([0, 0, 0, 0])
    sim.toggleSwitch('sa', 3)
    sim.step()
    expect(sim.signalOf('sa', 'out:0')).toEqual([0, 0, 0, 1])
    expect(sim.signal('fo', 'out:3')).toBe(1)
  })

  it("sets a switch-array's whole lane vector in BUS mode", () => {
    const sim = new Simulation(
      mkDesign([inst('sa', switchBus), inst('fo', fanOut4)], [conn('c1', iref('sa', 'out:0'), iref('fo', 'in:0'))]),
    )
    sim.setSwitchLanes('sa', [1, 0, 1, 0])
    sim.step()
    expect(sim.signalOf('sa', 'out:0')).toEqual([1, 0, 1, 0])
    expect(sim.signal('fo', 'out:0')).toBe(1)
    expect(sim.signal('fo', 'out:1')).toBe(0)
    expect(sim.signal('fo', 'out:2')).toBe(1)
    expect(sim.signal('fo', 'out:3')).toBe(0)
  })

  it("reports a switch-array's current raw lanes, padded to its lane count", () => {
    const sim = new Simulation(
      mkDesign([inst('sa', switchArray3, { initialValue: true })], []),
    )
    expect(sim.switchLanesOf('sa')).toEqual([1, 1, 1])
    sim.setSwitchLanes('sa', [0, 1])
    expect(sim.switchLanesOf('sa')).toEqual([0, 1, 0])
    expect(sim.switchLanesOf('nope')).toBeUndefined()
  })

  it('passes a fixed-width bus through the BUS primitive', () => {
    const sim = new Simulation(
      mkDesign(
        [inst('sa', switchBus), inst('b', bus2, { lanes: 4 }), inst('fo', fanOut4)],
        [
          conn('c1', iref('sa', 'out:0'), iref('b', 'in:0')),
          conn('c2', iref('b', 'out:0'), iref('fo', 'in:0')),
        ],
      ),
    )
    expect(sim.signalOf('b', 'in:0')).toEqual([0, 0, 0, 0])
    sim.toggleSwitch('sa', 3)
    sim.step()
    expect(sim.signalOf('b', 'in:0')).toEqual([0, 0, 0, 1])
    expect(sim.signalOf('b', 'out:0')).toEqual([0, 0, 0, 1])
    expect(sim.signal('fo', 'out:3')).toBe(1)
  })

  it('resolves the seven-seg bus input to the fixed source width', () => {
    const sim = new Simulation(
      mkDesign(
        [inst('sa', switchBus), inst('b', bus2, { lanes: 8 }), inst('seg', 'seven-seg')],
        [
          conn('c1', iref('sa', 'out:0'), iref('b', 'in:0')),
          conn('c2', iref('b', 'out:0'), iref('seg', 'in:0')),
        ],
      ),
    )
    expect(sim.signalOf('seg', 'in:0')).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    sim.toggleSwitch('sa', 5)
    sim.step()
    expect(sim.signalOf('seg', 'in:0')).toEqual([0, 0, 0, 0, 0, 1, 0, 0])
  })

  it('inverts a switch-array output when its terminal is inverted', () => {
    const sim = new Simulation(
      mkDesign([inst('sw', switchBusInv), inst('l', 'led-array')], [conn('c1', iref('sw', 'out:0'), iref('l', 'in:0'))]),
    )
    expect(sim.signal('l', 'in:0')).toBe(1)
    sim.setSwitch('sw', 1)
    sim.step()
    expect(sim.signal('l', 'in:0')).toBe(0)
  })

  it('DFF samples D on a posedge and ignores D changes between edges', () => {
    const sim = new Simulation(
      mkDesign(
        [inst('d', 'switch-array'), inst('clk', 'switch-array'), inst('f', 'dff')],
        [
          conn('c1', iref('d', 'out:0'), iref('f', 'in:0')),
          conn('c2', iref('clk', 'out:0'), iref('f', 'in:1')),
        ],
      ),
    )
    expect(sim.signal('f', 'out:0')).toBe(0)
    sim.setSwitch('d', 1)
    sim.step()
    expect(sim.signal('f', 'out:0')).toBe(0)
    sim.setSwitch('clk', 1)
    sim.step()
    expect(sim.signal('f', 'out:0')).toBe(1)
    sim.setSwitch('d', 0)
    sim.step()
    expect(sim.signal('f', 'out:0')).toBe(1)
    sim.setSwitch('clk', 0)
    sim.step()
    sim.setSwitch('clk', 1)
    sim.step()
    expect(sim.signal('f', 'out:0')).toBe(0)
  })

  it('DFF samples D on a negedge', () => {
    const sim = new Simulation(
      mkDesign(
        [inst('d', 'switch-array'), inst('clk', 'switch-array'), inst('f', 'dff', { edge: 'negedge' })],
        [
          conn('c1', iref('d', 'out:0'), iref('f', 'in:0')),
          conn('c2', iref('clk', 'out:0'), iref('f', 'in:1')),
        ],
      ),
    )
    sim.setSwitch('d', 1)
    sim.step()
    sim.setSwitch('clk', 1)
    sim.step()
    expect(sim.signal('f', 'out:0')).toBe(0)
    sim.setSwitch('clk', 0)
    sim.step()
    expect(sim.signal('f', 'out:0')).toBe(1)
  })

  it('DFF powers on to its initial value', () => {
    const sim = new Simulation(mkDesign([inst('f', 'dff', { initialValue: true })], []))
    expect(sim.signal('f', 'out:0')).toBe(1)
  })

  it('DFF drives the inverse of Q on its !Q output', () => {
    const sim = new Simulation(
      mkDesign(
        [inst('d', 'switch-array'), inst('clk', 'switch-array'), inst('rst', 'switch-array'), inst('f', 'dff')],
        [
          conn('c1', iref('d', 'out:0'), iref('f', 'in:0')),
          conn('c2', iref('clk', 'out:0'), iref('f', 'in:1')),
          conn('c3', iref('rst', 'out:0'), iref('f', 'in:2')),
        ],
      ),
    )
    expect(sim.signal('f', 'out:0')).toBe(0)
    expect(sim.signal('f', 'out:1')).toBe(1)
    sim.setSwitch('d', 1)
    sim.step()
    sim.setSwitch('clk', 1)
    sim.step()
    expect(sim.signal('f', 'out:0')).toBe(1)
    expect(sim.signal('f', 'out:1')).toBe(0)
    sim.setSwitch('rst', 1)
    sim.step()
    expect(sim.signal('f', 'out:0')).toBe(0)
    expect(sim.signal('f', 'out:1')).toBe(1)
  })

  it('DFF async reset overrides the clock, then releases on the next edge', () => {
    const sim = new Simulation(
      mkDesign(
        [inst('d', 'switch-array'), inst('clk', 'switch-array'), inst('rst', 'switch-array'), inst('f', 'dff')],
        [
          conn('c1', iref('d', 'out:0'), iref('f', 'in:0')),
          conn('c2', iref('clk', 'out:0'), iref('f', 'in:1')),
          conn('c3', iref('rst', 'out:0'), iref('f', 'in:2')),
        ],
      ),
    )
    sim.setSwitch('d', 1)
    sim.step()
    sim.setSwitch('clk', 1)
    sim.step()
    expect(sim.signal('f', 'out:0')).toBe(1)
    sim.setSwitch('rst', 1)
    sim.step()
    expect(sim.signal('f', 'out:0')).toBe(0)
    sim.setSwitch('clk', 0)
    sim.step()
    sim.setSwitch('clk', 1)
    sim.step()
    expect(sim.signal('f', 'out:0')).toBe(0)
    sim.setSwitch('rst', 0)
    sim.step()
    sim.setSwitch('clk', 0)
    sim.step()
    sim.setSwitch('clk', 1)
    sim.step()
    expect(sim.signal('f', 'out:0')).toBe(1)
  })

  it('DFF supports an active-low reset', () => {
    const sim = new Simulation(
      mkDesign(
        [inst('d', 'switch-array'), inst('clk', 'switch-array'), inst('rst', 'switch-array'), inst('f', 'dff', { resetActiveHigh: false })],
        [
          conn('c1', iref('d', 'out:0'), iref('f', 'in:0')),
          conn('c2', iref('clk', 'out:0'), iref('f', 'in:1')),
          conn('c3', iref('rst', 'out:0'), iref('f', 'in:2')),
        ],
      ),
    )
    sim.setSwitch('rst', 1)
    sim.step()
    sim.setSwitch('d', 1)
    sim.step()
    sim.setSwitch('clk', 1)
    sim.step()
    expect(sim.signal('f', 'out:0')).toBe(1)
    sim.setSwitch('rst', 0)
    sim.step()
    expect(sim.signal('f', 'out:0')).toBe(0)
  })

  it('chains DFFs into a shift register', () => {
    const sim = new Simulation(
      mkDesign(
        [inst('d', 'switch-array'), inst('clk', 'switch-array'), inst('f1', 'dff'), inst('f2', 'dff')],
        [
          conn('c1', iref('d', 'out:0'), iref('f1', 'in:0')),
          conn('c2', iref('clk', 'out:0'), iref('f1', 'in:1')),
          conn('c3', iref('clk', 'out:0'), iref('f2', 'in:1')),
          conn('c4', iref('f1', 'out:0'), iref('f2', 'in:0')),
        ],
      ),
    )
    sim.setSwitch('d', 1)
    sim.step()
    sim.setSwitch('clk', 1)
    sim.step()
    expect(sim.signal('f1', 'out:0')).toBe(1)
    expect(sim.signal('f2', 'out:0')).toBe(0)
    sim.setSwitch('d', 0)
    sim.step()
    sim.setSwitch('clk', 0)
    sim.step()
    sim.setSwitch('clk', 1)
    sim.step()
    expect(sim.signal('f1', 'out:0')).toBe(0)
    expect(sim.signal('f2', 'out:0')).toBe(1)
  })

  it('resolves DFF pins through a composite boundary', () => {
    const reg: ChildDef = {
      kind: 'composite',
      id: 'reg',
      name: 'reg',
      ports: [
        { id: 'in:0', name: 'D', direction: 'input', terminal: { instanceId: 'ci', pinId: 'in:0' } },
        { id: 'in:1', name: 'CLK', direction: 'input', terminal: { instanceId: 'ci', pinId: 'in:1' } },
        { id: 'in:2', name: 'RST', direction: 'input', terminal: { instanceId: 'ci', pinId: 'in:2' } },
        { id: 'out:0', name: 'Q', direction: 'output', terminal: { instanceId: 'co', pinId: 'out:0' } },
      ],
      instances: [
        { id: 'ci', name: '', def: INPUT_PORT, pos: { x: 0, y: 0 } },
        { id: 'f', name: 'f', def: forkOf('dff'), pos: { x: 60, y: 0 } },
        { id: 'co', name: '', def: OUTPUT_PORT, pos: { x: 120, y: 0 } },
      ],
      connections: [
        { id: 'c1', from: iref('ci', 'in:0'), to: iref('f', 'in:0') },
        { id: 'c2', from: iref('ci', 'in:1'), to: iref('f', 'in:1') },
        { id: 'c3', from: iref('ci', 'in:2'), to: iref('f', 'in:2') },
        { id: 'c4', from: iref('f', 'out:0'), to: iref('co', 'out:0') },
      ],
    }
    const sim = new Simulation(
      mkDesign(
        [inst('d', 'switch-array'), inst('clk', 'switch-array'), inst('r', reg)],
        [
          conn('w1', iref('d', 'out:0'), iref('r', 'in:0')),
          conn('w2', iref('clk', 'out:0'), iref('r', 'in:1')),
        ],
      ),
    )
    expect(sim.signal('r', 'out:0')).toBe(0)
    sim.setSwitch('d', 1)
    sim.step()
    sim.setSwitch('clk', 1)
    sim.step()
    expect(sim.signal('r', 'out:0')).toBe(1)
    expect(sim.signal('r.f', 'out:0')).toBe(1)
  })

  it('reports no timing breach when logic settles within a half period', () => {
    const sim = new Simulation(timingDesign(3), { ...DEFAULT_CONFIG, stepMode: 'clock-edge' })
    for (let i = 0; i < 10; i++) sim.step()
    expect(sim.hasSingleClock()).toBe(true)
    expect(sim.timingHalfViolation).toBe(false)
    expect(sim.timingFullViolation).toBe(false)
  })

  it('reports a half-period breach when logic settles past the next edge', () => {
    const sim = new Simulation(timingDesign(6), { ...DEFAULT_CONFIG, stepMode: 'clock-edge' })
    for (let i = 0; i < 10; i++) sim.step()
    expect(sim.timingHalfViolation).toBe(true)
    expect(sim.timingFullViolation).toBe(false)
  })

  it('reports a full-period breach when logic settles past a full period', () => {
    const sim = new Simulation(timingDesign(11), { ...DEFAULT_CONFIG, stepMode: 'clock-edge' })
    for (let i = 0; i < 20; i++) sim.step()
    expect(sim.timingHalfViolation).toBe(true)
    expect(sim.timingFullViolation).toBe(true)
  })

  it('does not report timing for zero or multiple clocks', () => {
    const noClock = new Simulation(
      mkDesign([inst('s', 'switch-array'), inst('l', 'led-array')], [conn('c', iref('s', 'out:0'), iref('l', 'in:0'))]),
    )
    expect(noClock.hasSingleClock()).toBe(false)

    const twoClocks = new Simulation(
      mkDesign([clk('c1', { period: 1000 }), clk('c2', { period: 2000 })], []),
    )
    expect(twoClocks.hasSingleClock()).toBe(false)
  })

  it('clears latched breaches on resetTiming()', () => {
    const sim = new Simulation(timingDesign(6), { ...DEFAULT_CONFIG, stepMode: 'clock-edge' })
    for (let i = 0; i < 10; i++) sim.step()
    expect(sim.timingHalfViolation).toBe(true)
    sim.resetTiming()
    expect(sim.timingHalfViolation).toBe(false)
    expect(sim.timingFullViolation).toBe(false)
  })
})
