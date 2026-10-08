import type { Port } from '../types'
import { inputPortId, outputPortId } from '../ports'
import { SequentialGate } from './sequential'
import type { DrawOptions, PropertySpec } from './primitive'
import type { VectorContext } from './vector'

/**
 * A positive/negative-edge-triggered D flip-flop with an optional asynchronous reset,
 * plus an inverted `!Q` output. A *stateful* primitive: the simulator evaluates it on
 * clock edges (and resets it level-sensitively) rather than through the combinational
 * `transfer`, so it maps 1:1 to a real register (and, later, to
 * `always @(posedge clk) …` in Verilog).
 */
export class Dff extends SequentialGate {
  readonly kind = 'dff' as const
  readonly label = 'DFF'
  readonly glyph = 'D'

  defaultPorts(): Port[] {
    return [
      { id: inputPortId(0), name: 'D', direction: 'input' },
      { id: inputPortId(1), name: 'CLK', direction: 'input' },
      { id: inputPortId(2), name: 'RST', direction: 'input', pull: 'down' },
      { id: outputPortId(0), name: 'Q', direction: 'output' },
      { id: outputPortId(1), name: '!Q', direction: 'output' },
    ]
  }

  clockPortId(): string {
    return 'in:1'
  }

  resetPortId(): string {
    return 'in:2'
  }

  complementPortId(): string {
    return 'out:1'
  }

  properties(): PropertySpec[] {
    return [
      { name: 'edge', label: 'Edge', type: 'select', default: 'posedge', options: ['posedge', 'negedge'] },
      { name: 'initialValue', label: 'Initial value', type: 'boolean', default: false },
      { name: 'resetActiveHigh', label: 'Active-high reset', type: 'boolean', default: true },
    ]
  }

  draw(ctx: VectorContext, opts: DrawOptions): void {
    this.drawBody(ctx, opts)
  }
}
