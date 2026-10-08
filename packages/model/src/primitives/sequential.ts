import type { PropertyValue, Signal } from '../types'
import { Gate, gateBounds } from './gate'
import type { DrawOptions } from './primitive'
import type { VectorContext } from './vector'

/**
 * Base class for the stateful (edge-triggered) primitives — the DFF, REGISTER, and
 * COUNTER. Supplies the defaults shared across them: fixed terminals, no auto input
 * naming, sequential evaluation (the simulator drives them on clock edges rather than
 * through the combinational `transfer`), terminal names shown, and a shared body size
 * plus rounded-rectangle body.
 */
export abstract class SequentialGate extends Gate {
  readonly fixedInputs: boolean = true
  readonly fixedOutputs: boolean = true

  nextInputName(): string | null {
    return null
  }

  isSequential(_props?: Record<string, PropertyValue>): boolean {
    return true
  }

  showTerminalNames(): boolean {
    return true
  }

  bodySize(): { w: number; h: number } {
    return { w: 56, h: 48 }
  }

  transfer(): Signal[][] {
    // Stateful (edge-triggered): driven by the simulator's sequential path.
    return []
  }

  /** The shared rounded-rectangle body (fill + stroke), drawn before the per-kind glyph. */
  protected drawBody(ctx: VectorContext, opts: DrawOptions): void {
    const { l, r, t, b } = gateBounds(opts)
    ctx.beginPath()
    ctx.roundRect(l, t, r - l, b - t, 6)
    ctx.fill(opts.palette.gateFill)
    ctx.stroke(opts.palette.gateStroke, 1.5)
  }
}
