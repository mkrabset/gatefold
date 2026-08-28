import { describe, expect, it } from 'vitest'
import type { ComponentDef, Design, Instance, PinRef, Port } from '@gatefold/model'
import { serializeDesign, withBuiltinPrimitives } from '@gatefold/model'
import { exportVerilog } from '../src/index'

const iref = (instanceId: string, portId: string): PinRef => ({ instanceId, portId })

const input = (id: string, name: string): Port => ({ id, name, direction: 'input', terminal: { instanceId: 'pi', pinId: id } })
const output = (id: string, name: string): Port => ({ id, name, direction: 'output', terminal: { instanceId: 'po', pinId: id } })

const pgIn = (): Instance => ({ id: 'pi', name: '', defId: 'input-port', pos: { x: 0, y: 0 } })
const pgOut = (): Instance => ({ id: 'po', name: '', defId: 'output-port', pos: { x: 0, y: 0 } })

function jsonOf(root: ComponentDef, extraDefs: Record<string, ComponentDef> = {}): string {
  const design: Design = withBuiltinPrimitives({ version: 1, root: 'main', defs: { main: root, ...extraDefs } })
  return serializeDesign(design)
}

describe('exportVerilog', () => {
  it('emits a simple AND gate', () => {
    const main: ComponentDef = {
      id: 'main', name: 'main', kind: 'composite',
      ports: [input('in:0', 'A'), input('in:1', 'B'), output('out:0', 'Y')],
      instances: [pgIn(), { id: 'g', name: 'g', defId: 'and', pos: { x: 0, y: 0 } }, pgOut()],
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
    const main: ComponentDef = {
      id: 'main', name: 'main', kind: 'composite',
      ports: [input('in:0', 'A'), output('out:0', 'Y')],
      instances: [pgIn(), { id: 'n', name: 'n', defId: 'not', pos: { x: 0, y: 0 } }, pgOut()],
      connections: [
        { id: 'c1', from: iref('pi', 'in:0'), to: iref('n', 'in:0') },
        { id: 'c2', from: iref('n', 'out:0'), to: iref('po', 'out:0') },
      ],
    }
    const { source } = exportVerilog(jsonOf(main))
    expect(source).toContain('assign Y = ~(A);')
  })

  it('emits a DFF with a clock source (no reset)', () => {
    const main: ComponentDef = {
      id: 'main', name: 'main', kind: 'composite',
      ports: [input('in:0', 'D'), output('out:0', 'Q')],
      instances: [
        pgIn(),
        { id: 'clk', name: 'clk', defId: 'clock', pos: { x: 0, y: 0 }, props: { period: 1000 } },
        { id: 'f', name: 'f', defId: 'dff', pos: { x: 0, y: 0 } },
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
    const main: ComponentDef = {
      id: 'main', name: 'main', kind: 'composite',
      ports: [input('in:0', 'D'), input('in:1', 'RST'), output('out:0', 'Q')],
      instances: [
        pgIn(),
        { id: 'clk', name: 'clk', defId: 'clock', pos: { x: 0, y: 0 }, props: { period: 1000 } },
        { id: 'f', name: 'f', defId: 'dff', pos: { x: 0, y: 0 } },
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
    const main: ComponentDef = {
      id: 'main', name: 'main', kind: 'composite',
      ports: [input('in:0', 'D'), output('out:0', 'Q'), output('out:1', 'QN')],
      instances: [
        pgIn(),
        { id: 'clk', name: 'clk', defId: 'clock', pos: { x: 0, y: 0 }, props: { period: 1000 } },
        { id: 'f', name: 'f', defId: 'dff', pos: { x: 0, y: 0 } },
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
    const main: ComponentDef = {
      id: 'main', name: 'main', kind: 'composite',
      ports: [input('in:0', 'A'), input('in:1', 'B'), output('out:0', 'BUS')],
      instances: [pgIn(), { id: 'fi', name: 'fi', defId: 'fan-in', pos: { x: 0, y: 0 } }, pgOut()],
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
    const sub: ComponentDef = {
      id: 'sub', name: 'sub', kind: 'composite',
      ports: [input('in:0', 'A'), input('in:1', 'B'), output('out:0', 'Y')],
      instances: [pgIn(), { id: 'g', name: 'g', defId: 'and', pos: { x: 0, y: 0 } }, pgOut()],
      connections: [
        { id: 'c1', from: iref('pi', 'in:0'), to: iref('g', 'in:0') },
        { id: 'c2', from: iref('pi', 'in:1'), to: iref('g', 'in:1') },
        { id: 'c3', from: iref('g', 'out:0'), to: iref('po', 'out:0') },
      ],
    }
    const main: ComponentDef = {
      id: 'main', name: 'main', kind: 'composite',
      ports: [input('in:0', 'X'), input('in:1', 'Y'), output('out:0', 'Z')],
      instances: [pgIn(), { id: 's', name: 's', defId: 'sub', pos: { x: 0, y: 0 } }, pgOut()],
      connections: [
        { id: 'c1', from: iref('pi', 'in:0'), to: iref('s', 'in:0') },
        { id: 'c2', from: iref('pi', 'in:1'), to: iref('s', 'in:1') },
        { id: 'c3', from: iref('s', 'out:0'), to: iref('po', 'out:0') },
      ],
    }
    const { source } = exportVerilog(jsonOf(main, { sub }))
    expect(source).toContain('module sub')
    expect(source).toContain('module main')
    expect(source).toContain('sub s (')
    expect(source).toContain('.A(')
    expect(source).toContain('.B(')
    expect(source).toContain('.Y(')
  })

  it('sanitizes identifiers and avoids keywords', () => {
    const main: ComponentDef = {
      id: 'main', name: 'main', kind: 'composite',
      ports: [input('in:0', 'wire'), output('out:0', 'out put')],
      instances: [pgIn(), { id: 'my gate', name: 'my gate', defId: 'buffer', pos: { x: 0, y: 0 } }, pgOut()],
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
    const main: ComponentDef = {
      id: 'main', name: 'main', kind: 'composite',
      ports: [input('in:0', 'A'), output('out:0', 'Y')],
      instances: [pgIn(), { id: 'g', name: 'g', defId: 'and', pos: { x: 0, y: 0 } }, pgOut()],
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
    const sub: ComponentDef = {
      id: 'sub', name: 'sub', kind: 'composite',
      ports: [output('out:0', 'Y')],
      instances: [
        { id: 'sw', name: 'sw', defId: 'switch-array', pos: { x: 0, y: 0 }, props: { initialValue: true } },
        { id: 'b', name: 'b', defId: 'buffer', pos: { x: 0, y: 0 } },
        pgOut(),
      ],
      connections: [
        { id: 'c1', from: iref('sw', 'out:0'), to: iref('b', 'in:0') },
        { id: 'c2', from: iref('b', 'out:0'), to: iref('po', 'out:0') },
      ],
    }
    const main: ComponentDef = {
      id: 'main', name: 'main', kind: 'composite',
      ports: [output('out:0', 'Z')],
      instances: [{ id: 's', name: 's', defId: 'sub', pos: { x: 0, y: 0 } }, pgOut()],
      connections: [{ id: 'c', from: iref('s', 'out:0'), to: iref('po', 'out:0') }],
    }
    const { source, issues } = exportVerilog(jsonOf(main, { sub }))
    expect(issues.some((i) => i.level === 'info' && i.message.includes('fixed initial value'))).toBe(true)
    expect(source).toContain("assign sw_BUS = {1{1'b1}};")
  })
})
