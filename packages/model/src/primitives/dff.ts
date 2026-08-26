import type { Port, Signal } from '../types'
import { inputPortId, outputPortId } from '../types'
import { Gate, gateBounds } from './gate'
import type { DrawOptions, PropertySpec } from './primitive'
import type { VectorContext } from './vector'

/**
 * A positive/negative-edge-triggered D flip-flop with an optional asynchronous reset.
 * A *stateful* primitive: the simulator evaluates it on clock edges (and resets it
 * level-sensitively) rather than through the combinational `transfer`, so it maps 1:1
 * to a real register (and, later, to `always @(posedge clk) …` in Verilog).
 */
export class Dff extends Gate {
  readonly kind = 'dff' as const
  readonly label = 'DFF'
  readonly glyph = 'D'
  readonly fixedInputs = true
  readonly fixedOutputs = true

  defaultPorts(): Port[] {
    return [
      { id: inputPortId(0), name: 'D', direction: 'input' },
      { id: inputPortId(1), name: 'CLK', direction: 'input' },
      { id: inputPortId(2), name: 'RST', direction: 'input' },
      { id: outputPortId(0), name: 'Q', direction: 'output' },
    ]
  }

  nextInputName(): string | null {
    return null
  }

  isSequential(): boolean {
    return true
  }

  clockPortId(): string {
    return 'in:1'
  }

  resetPortId(): string {
    return 'in:2'
  }

  showTerminalNames(): boolean {
    return true
  }

  properties(): PropertySpec[] {
    return [
      { name: 'edge', label: 'Edge', type: 'select', default: 'posedge', options: ['posedge', 'negedge'] },
      { name: 'initialValue', label: 'Initial value', type: 'boolean', default: false },
      { name: 'resetActiveHigh', label: 'Active-high reset', type: 'boolean', default: true },
    ]
  }

  transfer(): Signal[][] {
    // Stateful (edge-triggered): driven by the simulator's sequential path.
    return []
  }

  bodySize(): { w: number; h: number } {
    return { w: 56, h: 48 }
  }

  draw(ctx: VectorContext, opts: DrawOptions): void {
    const { l, r, t, b } = gateBounds(opts)
    ctx.beginPath()
    ctx.roundRect(l, t, r - l, b - t, 6)
    ctx.fill(opts.palette.gateFill)
    ctx.stroke(opts.palette.gateStroke, 1.5)
  }
}
