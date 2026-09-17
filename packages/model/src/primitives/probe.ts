import type { Port, PrimitiveKind, Signal } from '../types'
import { inputPortId } from '../ports'
import { Gate, fillAndStroke, gateBounds } from './gate'
import type { DrawOptions } from './primitive'
import type { VectorContext } from './vector'

/**
 * A monitoring probe: a single input terminal that taps a wire (single) or bus and is
 * recorded by the simulator for the simulation timeline. It is a pure sink — it has no
 * outputs and does not affect the circuit. Its input adopts the connected width (neutral
 * single-wire or bus). Probes are excluded from grouping, so a probe selected alongside
 * real components stays in the parent sheet rather than moving into the new component.
 */
export class Probe extends Gate {
  readonly kind: PrimitiveKind = 'probe'
  readonly label: string = 'PROBE'
  readonly glyph: string = '⊕'
  readonly fixedInputs = true
  readonly fixedOutputs = true
  readonly allowInversion = false

  defaultPorts(): Port[] {
    return [{ id: inputPortId(0), name: 'IN', direction: 'input' }]
  }

  nextInputName(): string | null {
    return null
  }

  bodySize(): { w: number; h: number } {
    return { w: 28, h: 24 }
  }

  /** A neutral (adopting) terminal: single-wire or bus, whichever it is connected to. */
  intrinsicWidth(): number | null {
    return null
  }

  transfer(): Signal[][] {
    // Sink: read by the simulator's history recorder, never driven.
    return []
  }

  draw(ctx: VectorContext, opts: DrawOptions): void {
    const { l, r, t, b, cx, cy } = gateBounds(opts)
    ctx.beginPath()
    ctx.roundRect(l, t, r - l, b - t, 5)
    fillAndStroke(ctx, opts.palette)
    // A filled dot with a short lead-in line, evoking an oscilloscope probe tip.
    const r0 = Math.min(opts.h, opts.w) * 0.16
    ctx.beginPath()
    ctx.moveTo(cx - r0 * 2, cy)
    ctx.lineTo(cx + r0, cy)
    ctx.stroke(opts.palette.gateStroke, 1.2)
    ctx.beginPath()
    ctx.arc(cx + r0, cy, r0, 0, Math.PI * 2)
    ctx.fill(opts.palette.gateStroke)
  }
}
