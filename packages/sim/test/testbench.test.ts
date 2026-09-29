import { describe, expect, it } from 'vitest'
import type { CompositeDef, Design, Instance, PinRef } from '@gatefold/model'
import { MAIN_INSTANCE_ID, builtinOf, forkOf, withTestbench } from '@gatefold/model'
import { Simulation } from '../src/engine'

const iref = (instanceId: string, portId: string): PinRef => ({ instanceId, portId })
const INPUT_PORT = builtinOf('input-port')
const OUTPUT_PORT = builtinOf('output-port')

/** A root composite with an input `A` and output `Y`, buffered together. */
function rootComposite(): CompositeDef {
  return {
    id: 'main',
    name: 'main',
    kind: 'composite',
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
}

/** A design whose testbench drives `main`'s input with a switch and reads its output with a probe. */
function testbenchDesign(extra: { instances?: Instance[]; connections?: CompositeDef['connections'] } = {}): Design {
  return {
    version: 2,
    root: rootComposite(),
    library: {},
    testbench: {
      main: { pos: { x: 0, y: 0 } },
      instances: [
        { id: 'sw', name: '', def: forkOf('switch-array'), pos: { x: -100, y: -40 } },
        { id: 'p', name: '', def: forkOf('probe'), pos: { x: 120, y: 40 } },
        ...(extra.instances ?? []),
      ],
      connections: [
        { id: 't1', from: iref('sw', 'out:0'), to: iref(MAIN_INSTANCE_ID, 'in:0') },
        { id: 't2', from: iref(MAIN_INSTANCE_ID, 'out:0'), to: iref('p', 'in:0') },
        ...(extra.connections ?? []),
      ],
    },
  }
}

describe('test-bench simulation', () => {
  it('drives main inputs from an external switch and reads its outputs', () => {
    const sim = new Simulation(withTestbench(testbenchDesign()))

    expect(sim.signal(MAIN_INSTANCE_ID, 'in:0')).toBe(0)
    expect(sim.signal(MAIN_INSTANCE_ID, 'out:0')).toBe(0)
    // The probe reading `main`'s output is at the test-bench top level (no path prefix).
    expect(sim.signal('p', 'in:0')).toBe(0)

    sim.setSwitch('sw', 1)
    sim.step()
    expect(sim.signal(MAIN_INSTANCE_ID, 'in:0')).toBe(1)
    expect(sim.signal(MAIN_INSTANCE_ID, 'out:0')).toBe(1)
    expect(sim.signal('p', 'in:0')).toBe(1)
  })

  it('an external clock drives sequential logic inside main', () => {
    const dffRoot: CompositeDef = {
      id: 'main',
      name: 'main',
      kind: 'composite',
      ports: [
        { id: 'in:0', name: 'CLK', direction: 'input', terminal: { instanceId: 'ci', pinId: 'in:0' } },
        { id: 'in:1', name: 'D', direction: 'input', terminal: { instanceId: 'ci', pinId: 'in:1' } },
        { id: 'out:0', name: 'Q', direction: 'output', terminal: { instanceId: 'co', pinId: 'out:0' } },
      ],
      instances: [
        { id: 'ci', name: '', def: INPUT_PORT, pos: { x: 0, y: 0 } },
        { id: 'dff', name: 'dff', def: forkOf('dff'), pos: { x: 60, y: 0 } },
        { id: 'co', name: '', def: OUTPUT_PORT, pos: { x: 120, y: 0 } },
      ],
      connections: [
        { id: 'c1', from: iref('ci', 'in:0'), to: iref('dff', 'in:1') },
        { id: 'c2', from: iref('ci', 'in:1'), to: iref('dff', 'in:0') },
        { id: 'c3', from: iref('dff', 'out:0'), to: iref('co', 'out:0') },
      ],
    }
    const design: Design = {
      version: 2,
      root: dffRoot,
      library: {},
      testbench: {
        main: { pos: { x: 0, y: 0 } },
        instances: [
          { id: 'clk', name: '', def: forkOf('clock'), props: { period: 1000 }, pos: { x: -100, y: -40 } },
          { id: 'sw', name: '', def: forkOf('switch-array'), pos: { x: -100, y: 0 } },
        ],
        connections: [
          { id: 't1', from: iref('clk', 'out:0'), to: iref(MAIN_INSTANCE_ID, 'in:0') },
          { id: 't2', from: iref('sw', 'out:0'), to: iref(MAIN_INSTANCE_ID, 'in:1') },
        ],
      },
    }
    const sim = new Simulation(withTestbench(design))

    sim.setSwitch('sw', 1)
    sim.step()
    expect(sim.signal(MAIN_INSTANCE_ID, 'out:0')).toBe(0) // D not sampled until a clock edge
    sim.advanceTo(1000)
    sim.step()
    expect(sim.signal(MAIN_INSTANCE_ID, 'out:0')).toBe(1)
  })
})
