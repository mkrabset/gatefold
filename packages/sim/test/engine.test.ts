import { describe, expect, it } from 'vitest'
import type { ComponentDef, Design, Instance, PinRef } from '@logica/model'
import { inputPortDef, outputPortDef, primitiveDef } from '@logica/model'
import { Simulation } from '../src/engine'
import { DEFAULT_CONFIG } from '../src/config'

const iref = (instanceId: string, portId: string): PinRef => ({ instanceId, portId })
const inst = (id: string, defId: string): Instance => ({ id, name: id, defId, pos: { x: 0, y: 0 } })
const conn = (id: string, from: PinRef, to: PinRef) => ({ id, from, to })

const LIBRARY = ['and', 'or', 'xor', 'not', 'buffer', 'clock', 'fan-in', 'fan-out', 'bus-split', 'bus-merge', 'switch', 'led', 'seven-seg'] as const

function mkDesign(
  instances: ComponentDef['instances'],
  connections: ComponentDef['connections'],
  extraDefs: Record<string, ComponentDef> = {},
): Design {
  const defs: Record<string, ComponentDef> = {}
  for (const k of LIBRARY) defs[k] = primitiveDef(k)
  defs['input-port'] = inputPortDef()
  defs['output-port'] = outputPortDef()
  Object.assign(defs, extraDefs)
  defs['main'] = { id: 'main', name: 'main', kind: 'composite', ports: [], instances, connections }
  return { version: 1, root: 'main', defs }
}

describe('Simulation engine', () => {
  it('propagates combinational logic from switches', () => {
    const sim = new Simulation(
      mkDesign(
        [inst('a', 'switch'), inst('b', 'switch'), inst('g', 'and')],
        [conn('c1', iref('a', 'out:0'), iref('g', 'in:0')), conn('c2', iref('b', 'out:0'), iref('g', 'in:1'))],
      ),
    )
    sim.setSwitch('a', 1)
    sim.setSwitch('b', 1)
    sim.step()
    expect(sim.signal('g', 'out:0')).toBe(1)
  })

  it('propagates unknown through an unconnected input', () => {
    const sim = new Simulation(
      mkDesign([inst('a', 'switch'), inst('g', 'and')], [conn('c1', iref('a', 'out:0'), iref('g', 'in:0'))]),
    )
    sim.setSwitch('a', 1)
    sim.step()
    expect(sim.signal('g', 'out:0')).toBe('x')
  })

  it('settles a NOR SR latch with set/reset/hold', () => {
    // Q = NOR(R, Qbar); Qbar = NOR(S, Q). S=1 sets, R=1 resets, S=R=0 holds.
    const sim = new Simulation(
      mkDesign(
        [inst('s', 'switch'), inst('r', 'switch'), inst('o1', 'or'), inst('n1', 'not'), inst('o2', 'or'), inst('n2', 'not')],
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

    // Power-on: the bi-stable loop resolves to a definite state.
    expect(sim.signal('n1', 'out:0')).not.toBe('x')
    expect(sim.signal('n2', 'out:0')).not.toBe('x')
    expect(sim.signal('n2', 'out:0')).not.toBe(sim.signal('n1', 'out:0'))

    // Set.
    sim.setSwitch('s', 1)
    sim.step()
    expect(sim.signal('n1', 'out:0')).toBe(1)
    expect(sim.signal('n2', 'out:0')).toBe(0)

    // Hold (release set).
    sim.setSwitch('s', 0)
    sim.step()
    expect(sim.signal('n1', 'out:0')).toBe(1)

    // Reset.
    sim.setSwitch('r', 1)
    sim.step()
    expect(sim.signal('n1', 'out:0')).toBe(0)
    expect(sim.signal('n2', 'out:0')).toBe(1)

    // Hold (release reset).
    sim.setSwitch('r', 0)
    sim.step()
    expect(sim.signal('n1', 'out:0')).toBe(0)
  })

  it('detects a gate-level oscillator and marks it unknown', () => {
    // NAND(enable, feedback): enable=1 makes output = NOT(feedback) → oscillates.
    const sim = new Simulation(
      mkDesign(
        [inst('en', 'switch'), inst('a', 'and'), inst('n', 'not')],
        [
          conn('c1', iref('en', 'out:0'), iref('a', 'in:0')),
          conn('c2', iref('n', 'out:0'), iref('a', 'in:1')),
          conn('c3', iref('a', 'out:0'), iref('n', 'in:0')),
        ],
      ),
    )
    // enable=0: AND(0, feedback) = 0, stable.
    sim.setSwitch('en', 0)
    sim.step()
    expect(sim.signal('a', 'out:0')).toBe(0)

    // enable=1: output = NOT(feedback) → oscillates → unknown.
    sim.setSwitch('en', 1)
    sim.step()
    expect(sim.signal('a', 'out:0')).toBe('x')
  })

  it('powers on and sets/resets a gated JK flip-flop (2 NOR + 2 AND)', () => {
    const nor: ComponentDef = {
      id: 'nor',
      name: 'NOR',
      kind: 'primitive',
      primitive: 'or',
      ports: [
        { id: 'in:0', name: 'A', direction: 'input' },
        { id: 'in:1', name: 'B', direction: 'input' },
        { id: 'out:0', name: 'Y', direction: 'output', inverted: true },
      ],
    }
    const and3: ComponentDef = {
      id: 'and3',
      name: 'AND3',
      kind: 'primitive',
      primitive: 'and',
      ports: [
        { id: 'in:0', name: 'A', direction: 'input' },
        { id: 'in:1', name: 'B', direction: 'input' },
        { id: 'in:2', name: 'C', direction: 'input' },
        { id: 'out:0', name: 'Y', direction: 'output' },
      ],
    }
    const sim = new Simulation(
      mkDesign(
        [
          inst('j', 'switch'),
          inst('k', 'switch'),
          inst('clk', 'switch'),
          inst('a1', 'and3'),
          inst('a2', 'and3'),
          inst('n1', 'nor'),
          inst('n2', 'nor'),
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
        { nor, and3 },
      ),
    )

    // Power-on: the internal latch resolves to a definite state (deadlock broken).
    expect(sim.signal('n1', 'out:0')).not.toBe('x')
    expect(sim.signal('n2', 'out:0')).not.toBe('x')
    expect(sim.signal('n1', 'out:0')).not.toBe(sim.signal('n2', 'out:0'))

    // Set (J=1, CLK=1).
    sim.setSwitch('j', 1)
    sim.setSwitch('clk', 1)
    sim.step()
    expect(sim.signal('n1', 'out:0')).toBe(1)
    expect(sim.signal('n2', 'out:0')).toBe(0)

    // Reset (J=0, K=1, CLK=1).
    sim.setSwitch('j', 0)
    sim.setSwitch('k', 1)
    sim.step()
    expect(sim.signal('n1', 'out:0')).toBe(0)
    expect(sim.signal('n2', 'out:0')).toBe(1)
  })

  it('edge-triggers a master-slave JK flip-flop (8 NAND + NOT)', () => {
    const nand2: ComponentDef = {
      id: 'nand2',
      name: 'NAND2',
      kind: 'primitive',
      primitive: 'and',
      ports: [
        { id: 'in:0', name: 'A', direction: 'input' },
        { id: 'in:1', name: 'B', direction: 'input' },
        { id: 'out:0', name: 'Y', direction: 'output', inverted: true },
      ],
    }
    const nand3: ComponentDef = {
      id: 'nand3',
      name: 'NAND3',
      kind: 'primitive',
      primitive: 'and',
      ports: [
        { id: 'in:0', name: 'A', direction: 'input' },
        { id: 'in:1', name: 'B', direction: 'input' },
        { id: 'in:2', name: 'C', direction: 'input' },
        { id: 'out:0', name: 'Y', direction: 'output', inverted: true },
      ],
    }
    const sim = new Simulation(
      mkDesign(
        [
          inst('j', 'switch'),
          inst('k', 'switch'),
          inst('clk', 'switch'),
          inst('notClk', 'not'),
          inst('m1', 'nand3'),
          inst('m2', 'nand3'),
          inst('m3', 'nand2'),
          inst('m4', 'nand2'),
          inst('s1', 'nand2'),
          inst('s2', 'nand2'),
          inst('s3', 'nand2'),
          inst('s4', 'nand2'),
        ],
        [
          // master: gated JK
          conn('c1', iref('j', 'out:0'), iref('m1', 'in:0')),
          conn('c2', iref('s4', 'out:0'), iref('m1', 'in:1')),
          conn('c3', iref('clk', 'out:0'), iref('m1', 'in:2')),
          conn('c4', iref('k', 'out:0'), iref('m2', 'in:0')),
          conn('c5', iref('s3', 'out:0'), iref('m2', 'in:1')),
          conn('c6', iref('clk', 'out:0'), iref('m2', 'in:2')),
          // master latch cross-coupling
          conn('c7', iref('m1', 'out:0'), iref('m3', 'in:0')),
          conn('c8', iref('m4', 'out:0'), iref('m3', 'in:1')),
          conn('c9', iref('m2', 'out:0'), iref('m4', 'in:0')),
          conn('c10', iref('m3', 'out:0'), iref('m4', 'in:1')),
          // clock inversion
          conn('c11', iref('clk', 'out:0'), iref('notClk', 'in:0')),
          // slave: gated by ¬CLK
          conn('c12', iref('m3', 'out:0'), iref('s1', 'in:0')),
          conn('c13', iref('notClk', 'out:0'), iref('s1', 'in:1')),
          conn('c14', iref('m4', 'out:0'), iref('s2', 'in:0')),
          conn('c15', iref('notClk', 'out:0'), iref('s2', 'in:1')),
          // slave latch cross-coupling
          conn('c16', iref('s1', 'out:0'), iref('s3', 'in:0')),
          conn('c17', iref('s4', 'out:0'), iref('s3', 'in:1')),
          conn('c18', iref('s2', 'out:0'), iref('s4', 'in:0')),
          conn('c19', iref('s3', 'out:0'), iref('s4', 'in:1')),
        ],
        { nand2, nand3 },
      ),
    )

    // Power-on: the whole chain resolves to a definite state.
    const q0 = sim.signal('s3', 'out:0')
    expect(q0).not.toBe('x')
    expect(sim.signal('s4', 'out:0')).not.toBe('x')
    expect(sim.signal('s4', 'out:0')).not.toBe(q0)

    // Set J=1 (no clock yet): no change.
    sim.setSwitch('j', 1)
    sim.step()
    expect(sim.signal('s3', 'out:0')).toBe(q0)

    // Rising edge: master latches, slave must NOT change.
    sim.setSwitch('clk', 1)
    sim.step()
    expect(sim.signal('s3', 'out:0')).toBe(q0)

    // Falling edge: slave captures → Q = 1.
    sim.setSwitch('clk', 0)
    sim.step()
    expect(sim.signal('s3', 'out:0')).toBe(1)

    // Reset: J=0, K=1, pulse CLK → Q = 0.
    sim.setSwitch('j', 0)
    sim.setSwitch('k', 1)
    sim.setSwitch('clk', 1)
    sim.step()
    sim.setSwitch('clk', 0)
    sim.step()
    expect(sim.signal('s3', 'out:0')).toBe(0)

    // Toggle: J=K=1 → Q flips on each clock pulse.
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
    const fanIn4: ComponentDef = {
      id: 'fi4',
      name: 'FAN-IN',
      kind: 'primitive',
      primitive: 'fan-in',
      ports: [
        { id: 'in:0', name: 'A', direction: 'input' },
        { id: 'in:1', name: 'B', direction: 'input' },
        { id: 'in:2', name: 'C', direction: 'input' },
        { id: 'in:3', name: 'D', direction: 'input' },
        { id: 'out:0', name: 'BUS', direction: 'output' },
      ],
    }
    const sim = new Simulation(
      mkDesign(
        [inst('s0', 'switch'), inst('s1', 'switch'), inst('s2', 'switch'), inst('s3', 'switch'), inst('fi', 'fi4'), inst('bs', 'bus-split')],
        [
          conn('c0', iref('s0', 'out:0'), iref('fi', 'in:0')),
          conn('c1', iref('s1', 'out:0'), iref('fi', 'in:1')),
          conn('c2', iref('s2', 'out:0'), iref('fi', 'in:2')),
          conn('c3', iref('s3', 'out:0'), iref('fi', 'in:3')),
          conn('c4', iref('fi', 'out:0'), iref('bs', 'in:0')),
        ],
        { fi4: fanIn4 },
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
      mkDesign(
        [{ id: 'clk', name: 'clk', defId: 'clock', pos: { x: 0, y: 0 }, props: { period: 1000 } }, inst('l', 'led')],
        [conn('c1', iref('clk', 'out:0'), iref('l', 'in:0'))],
      ),
    )
    expect(sim.signal('l', 'in:0')).toBe(1)
    sim.advanceTo(500)
    expect(sim.signal('l', 'in:0')).toBe(0)
    sim.advanceTo(1000)
    expect(sim.signal('l', 'in:0')).toBe(1)
  })

  it('steps one clock edge at a time in clock-edge mode', () => {
    const sim = new Simulation(
      mkDesign(
        [{ id: 'clk', name: 'clk', defId: 'clock', pos: { x: 0, y: 0 }, props: { period: 1000 } }, inst('l', 'led')],
        [conn('c1', iref('clk', 'out:0'), iref('l', 'in:0'))],
      ),
      { ...DEFAULT_CONFIG, stepMode: 'clock-edge' },
    )
    // Clock starts HIGH; each step advances to the next edge (period/2 = 500 ps).
    expect(sim.signal('l', 'in:0')).toBe(1)
    sim.step()
    expect(sim.signal('l', 'in:0')).toBe(0)
    sim.step()
    expect(sim.signal('l', 'in:0')).toBe(1)
    sim.step()
    expect(sim.signal('l', 'in:0')).toBe(0)
  })
})
