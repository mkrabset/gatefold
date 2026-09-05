import { describe, expect, it } from 'vitest'
import type { CompositeDef, Design, Instance, PinRef, Port } from '@gatefold/model'
import { builtinOf, forkOf, serializeDesign } from '@gatefold/model'
import { exportVerilog } from '../src/index'

const iref = (instanceId: string, portId: string): PinRef => ({ instanceId, portId })

const input = (id: string, name: string): Port => ({ id, name, direction: 'input', terminal: { instanceId: 'pi', pinId: id } })
const output = (id: string, name: string): Port => ({ id, name, direction: 'output', terminal: { instanceId: 'po', pinId: id } })

const pgIn = (): Instance => ({ id: 'pi', name: '', def: builtinOf('input-port'), pos: { x: 0, y: 0 } })
const pgOut = (): Instance => ({ id: 'po', name: '', def: builtinOf('output-port'), pos: { x: 0, y: 0 } })
const prim = (id: string, kind: Parameters<typeof forkOf>[0], props?: Instance['props']): Instance => ({
  id,
  name: id,
  def: forkOf(kind),
  pos: { x: 0, y: 0 },
  ...(props ? { props } : {}),
})
const composite = (id: string, def: CompositeDef): Instance => ({ id, name: id, def, pos: { x: 0, y: 0 } })

function jsonOf(root: CompositeDef): string {
  const design: Design = { version: 2, root, library: {} }
  return serializeDesign(design)
}

describe('exportVerilog', () => {
  it('emits a simple AND gate', () => {
    const main: CompositeDef = {
      id: 'main', name: 'main', kind: 'composite',
      ports: [input('in:0', 'A'), input('in:1', 'B'), output('out:0', 'Y')],
      instances: [pgIn(), prim('g', 'and'), pgOut()],
      connections: [
        { id: 'c1', from: iref('pi', 'in:0'), to: iref('g', 'in:0') },
        { id: 'c2', from: iref('pi', 'in:1'), to: iref('g', 'in:1') },
        { id: 'c3', from: iref('g', 'out:0'), to: iref('po', 'out:0') },
      ],
    }
    const { source } = exportVerilog(jsonOf(main))
    expect(source).toContain('module main (')
    expect(source).toContain('input A')
    expect(source).toContain('input B')
    expect(source).toContain('output Y')
    expect(source).toContain('assign Y = A & B;')
  })

  it('applies terminal inversion', () => {
    const main: CompositeDef = {
      id: 'main', name: 'main', kind: 'composite',
      ports: [input('in:0', 'A'), output('out:0', 'Y')],
      instances: [pgIn(), prim('n', 'not'), pgOut()],
      connections: [
        { id: 'c1', from: iref('pi', 'in:0'), to: iref('n', 'in:0') },
        { id: 'c2', from: iref('n', 'out:0'), to: iref('po', 'out:0') },
      ],
    }
    const { source } = exportVerilog(jsonOf(main))
    expect(source).toContain('assign Y = ~(A);')
  })

  it('emits a NODE join-point as a passthrough assign', () => {
    const main: CompositeDef = {
      id: 'main', name: 'main', kind: 'composite',
      ports: [input('in:0', 'A'), output('out:0', 'Y')],
      instances: [pgIn(), prim('j', 'join-point'), pgOut()],
      connections: [
        { id: 'c1', from: iref('pi', 'in:0'), to: iref('j', 'in:0') },
        { id: 'c2', from: iref('j', 'out:0'), to: iref('po', 'out:0') },
      ],
    }
    const { source } = exportVerilog(jsonOf(main))
    expect(source).toContain('assign Y = A;')
  })

  it('bridges a source wired straight to a sink with an assign', () => {
    const main: CompositeDef = {
      id: 'main', name: 'main', kind: 'composite',
      ports: [],
      instances: [
        { id: 'sw', name: 'SWITCHES', def: forkOf('switch-array'), pos: { x: 0, y: 0 } },
        { id: 'led', name: 'LEDS', def: forkOf('led-array'), pos: { x: 0, y: 0 } },
      ],
      connections: [{ id: 'c1', from: iref('sw', 'out:0'), to: iref('led', 'in:0') }],
    }
    const { source } = exportVerilog(jsonOf(main))
    expect(source).toContain('input SWITCHES_BUS')
    expect(source).toContain('output LEDS_BUS')
    expect(source).toContain('assign LEDS_BUS = SWITCHES_BUS;')
  })

  it('emits a DFF with a clock source (no reset)', () => {
    const main: CompositeDef = {
      id: 'main', name: 'main', kind: 'composite',
      ports: [input('in:0', 'D'), output('out:0', 'Q')],
      instances: [
        pgIn(),
        prim('clk', 'clock', { period: 1000 }),
        prim('f', 'dff'),
        pgOut(),
      ],
      connections: [
        { id: 'c1', from: iref('pi', 'in:0'), to: iref('f', 'in:0') },
        { id: 'c2', from: iref('clk', 'out:0'), to: iref('f', 'in:1') },
        { id: 'c3', from: iref('f', 'out:0'), to: iref('po', 'out:0') },
      ],
    }
    const { source } = exportVerilog(jsonOf(main))
    expect(source).toContain('input clk_CLK')
    expect(source).toContain('output reg Q')
    expect(source).toContain('always @(posedge clk_CLK) Q <= D;')
  })

  it('emits a DFF with an async reset', () => {
    const main: CompositeDef = {
      id: 'main', name: 'main', kind: 'composite',
      ports: [input('in:0', 'D'), input('in:1', 'RST'), output('out:0', 'Q')],
      instances: [
        pgIn(),
        prim('clk', 'clock', { period: 1000 }),
        prim('f', 'dff'),
        pgOut(),
      ],
      connections: [
        { id: 'c1', from: iref('pi', 'in:0'), to: iref('f', 'in:0') },
        { id: 'c2', from: iref('pi', 'in:1'), to: iref('f', 'in:2') },
        { id: 'c3', from: iref('clk', 'out:0'), to: iref('f', 'in:1') },
        { id: 'c4', from: iref('f', 'out:0'), to: iref('po', 'out:0') },
      ],
    }
    const { source } = exportVerilog(jsonOf(main))
    expect(source).toContain("always @(posedge clk_CLK or posedge RST) if (RST) Q <= 1'b0; else Q <= D;")
  })

  it('emits an inverted Q as a continuous assignment from Q', () => {
    const main: CompositeDef = {
      id: 'main', name: 'main', kind: 'composite',
      ports: [input('in:0', 'D'), output('out:0', 'Q'), output('out:1', 'QN')],
      instances: [
        pgIn(),
        prim('clk', 'clock', { period: 1000 }),
        prim('f', 'dff'),
        pgOut(),
      ],
      connections: [
        { id: 'c1', from: iref('pi', 'in:0'), to: iref('f', 'in:0') },
        { id: 'c2', from: iref('clk', 'out:0'), to: iref('f', 'in:1') },
        { id: 'c3', from: iref('f', 'out:0'), to: iref('po', 'out:0') },
        { id: 'c4', from: iref('f', 'out:1'), to: iref('po', 'out:1') },
      ],
    }
    const { source } = exportVerilog(jsonOf(main))
    expect(source).toContain('output reg Q')
    expect(source).toContain('output QN')
    expect(source).toContain('always @(posedge clk_CLK) Q <= D;')
    expect(source).toContain('assign QN = ~(Q);')
  })

  it('emits bus concatenation for fan-in', () => {
    const main: CompositeDef = {
      id: 'main', name: 'main', kind: 'composite',
      ports: [input('in:0', 'A'), input('in:1', 'B'), output('out:0', 'BUS')],
      instances: [pgIn(), prim('fi', 'fan-in'), pgOut()],
      connections: [
        { id: 'c1', from: iref('pi', 'in:0'), to: iref('fi', 'in:0') },
        { id: 'c2', from: iref('pi', 'in:1'), to: iref('fi', 'in:1') },
        { id: 'c3', from: iref('fi', 'out:0'), to: iref('po', 'out:0') },
      ],
    }
    const { source } = exportVerilog(jsonOf(main))
    expect(source).toContain('output [1:0] BUS')
    expect(source).toContain('assign BUS = {B, A};')
  })

  it('emits nested composite modules', () => {
    const sub: CompositeDef = {
      id: 'sub', name: 'sub', kind: 'composite',
      ports: [input('in:0', 'A'), input('in:1', 'B'), output('out:0', 'Y')],
      instances: [pgIn(), prim('g', 'and'), pgOut()],
      connections: [
        { id: 'c1', from: iref('pi', 'in:0'), to: iref('g', 'in:0') },
        { id: 'c2', from: iref('pi', 'in:1'), to: iref('g', 'in:1') },
        { id: 'c3', from: iref('g', 'out:0'), to: iref('po', 'out:0') },
      ],
    }
    const main: CompositeDef = {
      id: 'main', name: 'main', kind: 'composite',
      ports: [input('in:0', 'X'), input('in:1', 'Y'), output('out:0', 'Z')],
      instances: [pgIn(), composite('s', sub), pgOut()],
      connections: [
        { id: 'c1', from: iref('pi', 'in:0'), to: iref('s', 'in:0') },
        { id: 'c2', from: iref('pi', 'in:1'), to: iref('s', 'in:1') },
        { id: 'c3', from: iref('s', 'out:0'), to: iref('po', 'out:0') },
      ],
    }
    const { source } = exportVerilog(jsonOf(main))
    expect(source).toContain('module sub')
    expect(source).toContain('module main')
    expect(source).toContain('sub s (')
    expect(source).toContain('.A(')
    expect(source).toContain('.B(')
    expect(source).toContain('.Y(')
  })

  it('applies inversion to a composite instance input terminal', () => {
    const sub: CompositeDef = {
      id: 'sub', name: 'sub', kind: 'composite',
      ports: [
        { id: 'in:0', name: 'A', direction: 'input', terminal: { instanceId: 'pi', pinId: 'in:0' }, inverted: true },
        input('in:1', 'B'),
        output('out:0', 'Y'),
      ],
      instances: [pgIn(), prim('g', 'and'), pgOut()],
      connections: [
        { id: 'c1', from: iref('pi', 'in:0'), to: iref('g', 'in:0') },
        { id: 'c2', from: iref('pi', 'in:1'), to: iref('g', 'in:1') },
        { id: 'c3', from: iref('g', 'out:0'), to: iref('po', 'out:0') },
      ],
    }
    const main: CompositeDef = {
      id: 'main', name: 'main', kind: 'composite',
      ports: [input('in:0', 'X'), input('in:1', 'Y'), output('out:0', 'Z')],
      instances: [pgIn(), composite('s', sub), pgOut()],
      connections: [
        { id: 'c1', from: iref('pi', 'in:0'), to: iref('s', 'in:0') },
        { id: 'c2', from: iref('pi', 'in:1'), to: iref('s', 'in:1') },
        { id: 'c3', from: iref('s', 'out:0'), to: iref('po', 'out:0') },
      ],
    }
    const { source } = exportVerilog(jsonOf(main))
    expect(source).toContain('assign s_A_inv = ~X;')
    expect(source).toContain('.A(s_A_inv)')
  })

  it('applies inversion to a composite instance output terminal', () => {
    const sub: CompositeDef = {
      id: 'sub', name: 'sub', kind: 'composite',
      ports: [
        input('in:0', 'A'),
        { id: 'out:0', name: 'Y', direction: 'output', terminal: { instanceId: 'po', pinId: 'out:0' }, inverted: true },
      ],
      instances: [pgIn(), prim('b', 'buffer'), pgOut()],
      connections: [
        { id: 'c1', from: iref('pi', 'in:0'), to: iref('b', 'in:0') },
        { id: 'c2', from: iref('b', 'out:0'), to: iref('po', 'out:0') },
      ],
    }
    const main: CompositeDef = {
      id: 'main', name: 'main', kind: 'composite',
      ports: [input('in:0', 'X'), output('out:0', 'Z')],
      instances: [pgIn(), composite('s', sub), pgOut()],
      connections: [
        { id: 'c1', from: iref('pi', 'in:0'), to: iref('s', 'in:0') },
        { id: 'c2', from: iref('s', 'out:0'), to: iref('po', 'out:0') },
      ],
    }
    const { source } = exportVerilog(jsonOf(main))
    expect(source).toContain('.Y(s_Y_inv)')
    expect(source).toContain('assign Z = ~s_Y_inv;')
  })

  it('sanitizes identifiers and avoids keywords', () => {
    const main: CompositeDef = {
      id: 'main', name: 'main', kind: 'composite',
      ports: [input('in:0', 'wire'), output('out:0', 'out put')],
      instances: [pgIn(), { id: 'my gate', name: 'my gate', def: forkOf('buffer'), pos: { x: 0, y: 0 } }, pgOut()],
      connections: [
        { id: 'c1', from: iref('pi', 'in:0'), to: iref('my gate', 'in:0') },
        { id: 'c2', from: iref('my gate', 'out:0'), to: iref('po', 'out:0') },
      ],
    }
    const { source } = exportVerilog(jsonOf(main))
    expect(source).toContain('input wire_')
    expect(source).toContain('output out_put')
  })

  it('warns on floating inputs', () => {
    const main: CompositeDef = {
      id: 'main', name: 'main', kind: 'composite',
      ports: [input('in:0', 'A'), output('out:0', 'Y')],
      instances: [pgIn(), prim('g', 'and'), pgOut()],
      connections: [
        { id: 'c1', from: iref('pi', 'in:0'), to: iref('g', 'in:0') },
        { id: 'c2', from: iref('g', 'out:0'), to: iref('po', 'out:0') },
      ],
    }
    const { source, issues } = exportVerilog(jsonOf(main))
    expect(issues.some((i) => i.level === 'error' && i.message.includes('floating input'))).toBe(true)
    expect(source).toContain('assign Y = A & z;')
  })

  it('exports a nested switch as a fixed initial value', () => {
    const sub: CompositeDef = {
      id: 'sub', name: 'sub', kind: 'composite',
      ports: [output('out:0', 'Y')],
      instances: [
        { id: 'sw', name: 'sw', def: forkOf('switch-array'), pos: { x: 0, y: 0 }, props: { initialValue: true } },
        prim('b', 'buffer'),
        pgOut(),
      ],
      connections: [
        { id: 'c1', from: iref('sw', 'out:0'), to: iref('b', 'in:0') },
        { id: 'c2', from: iref('b', 'out:0'), to: iref('po', 'out:0') },
      ],
    }
    const main: CompositeDef = {
      id: 'main', name: 'main', kind: 'composite',
      ports: [output('out:0', 'Z')],
      instances: [composite('s', sub), pgOut()],
      connections: [{ id: 'c', from: iref('s', 'out:0'), to: iref('po', 'out:0') }],
    }
    const { source, issues } = exportVerilog(jsonOf(main))
    expect(issues.some((i) => i.level === 'info' && i.message.includes('fixed initial value'))).toBe(true)
    expect(source).toContain("assign sw_BUS = {1{1'b1}};")
  })

  it('emits an XOR gate as a ^ assignment', () => {
    const main: CompositeDef = {
      id: 'main', name: 'main', kind: 'composite',
      ports: [input('in:0', 'A'), input('in:1', 'B'), output('out:0', 'Y')],
      instances: [pgIn(), prim('x', 'xor'), pgOut()],
      connections: [
        { id: 'c1', from: iref('pi', 'in:0'), to: iref('x', 'in:0') },
        { id: 'c2', from: iref('pi', 'in:1'), to: iref('x', 'in:1') },
        { id: 'c3', from: iref('x', 'out:0'), to: iref('po', 'out:0') },
      ],
    }
    const { source } = exportVerilog(jsonOf(main))
    expect(source).toContain('assign Y = A ^ B;')
  })

  it('emits slicing for a bus-split fed by a fan-in bus', () => {
    const main: CompositeDef = {
      id: 'main', name: 'main', kind: 'composite',
      ports: [input('in:0', 'A'), input('in:1', 'B'), output('out:0', 'Y1'), output('out:1', 'Y2')],
      instances: [
        pgIn(),
        prim('fi', 'fan-in'),
        prim('bs', 'bus-split'),
        pgOut(),
      ],
      connections: [
        { id: 'c1', from: iref('pi', 'in:0'), to: iref('fi', 'in:0') },
        { id: 'c2', from: iref('pi', 'in:1'), to: iref('fi', 'in:1') },
        { id: 'c3', from: iref('fi', 'out:0'), to: iref('bs', 'in:0') },
        { id: 'c4', from: iref('bs', 'out:0'), to: iref('po', 'out:0') },
        { id: 'c5', from: iref('bs', 'out:1'), to: iref('po', 'out:1') },
      ],
    }
    const { source } = exportVerilog(jsonOf(main))
    expect(source).toContain('assign Y1 =')
    expect(source).toContain('assign Y2 =')
    expect(source).toContain('[0:0]')
    expect(source).toContain('[1:1]')
  })

  it('honors a DFF negedge, initial value, and active-low reset', () => {
    const main: CompositeDef = {
      id: 'main', name: 'main', kind: 'composite',
      ports: [input('in:0', 'D'), input('in:1', 'RST'), output('out:0', 'Q')],
      instances: [
        pgIn(),
        prim('clk', 'clock', { period: 1000 }),
        prim('f', 'dff', { edge: 'negedge', initialValue: true, resetActiveHigh: false }),
        pgOut(),
      ],
      connections: [
        { id: 'c1', from: iref('pi', 'in:0'), to: iref('f', 'in:0') },
        { id: 'c2', from: iref('pi', 'in:1'), to: iref('f', 'in:2') },
        { id: 'c3', from: iref('clk', 'out:0'), to: iref('f', 'in:1') },
        { id: 'c4', from: iref('f', 'out:0'), to: iref('po', 'out:0') },
      ],
    }
    const { source } = exportVerilog(jsonOf(main))
    expect(source).toContain("always @(negedge clk_CLK or negedge RST) if (!RST) Q <= 1'b1; else Q <= D;")
  })
})
