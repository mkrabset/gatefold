import type { Port, PropertyValue, Signal } from '../types'
import { outputPortId } from '../types'
import { Gate, gateBounds } from './gate'
import type { DrawOptions, PropertySpec } from './primitive'
import type { VectorContext } from './vector'

/** Default clock period (ps) when an instance has no explicit `period` property. */
export const CLOCK_DEFAULT_PERIOD = 10_000_000

/** Resolve an instance's clock period (ps), falling back to the default. */
export function periodOf(props: Record<string, PropertyValue> | undefined): number {
  return typeof props?.period === 'number' ? props.period : CLOCK_DEFAULT_PERIOD
}

export class Clock extends Gate {
  readonly kind = 'clock' as const
  readonly label = 'CLOCK'
  readonly glyph = '∿'
  readonly fixedInputs = true
  readonly fixedOutputs = true

  defaultPorts(): Port[] {
    return [{ id: outputPortId(0), name: 'CLK', direction: 'output' }]
  }

  nextInputName(): string | null {
    return null
  }

  bodySize(): { w: number; h: number } {
    return { w: 46, h: 46 }
  }

  transfer(): Signal[][] {
    // Source: driven by the simulator (square wave from `period`), not by inputs.
    return []
  }

  properties(): PropertySpec[] {
    return [{ name: 'period', label: 'Period', type: 'number', default: CLOCK_DEFAULT_PERIOD, unit: 'ps', min: 1 }]
  }

  draw(ctx: VectorContext, opts: DrawOptions): void {
    const { l, r, t, cy } = gateBounds(opts)
    const { w, h } = opts
    // Screen size / world size = zoom, so every glyph metric scales with zoom.
    const scale = h / this.bodySize().h
    ctx.beginPath()
    ctx.roundRect(l, t, w, h, 6 * scale)
    ctx.fill(opts.palette.gateFill)
    ctx.stroke(opts.palette.gateStroke, 1.5 * scale)
    // Square-wave glyph (sine phase: starts at mid and rises), scaled with the body.
    const amp = h * 0.22
    const x0 = l + w * 0.18
    const x1 = r - w * 0.18
    const e = (x1 - x0) / 8
    ctx.beginPath()
    ctx.moveTo(x0, cy)
    ctx.lineTo(x0 + e, cy)
    ctx.lineTo(x0 + e, cy - amp)
    ctx.lineTo(x0 + 3 * e, cy - amp)
    ctx.lineTo(x0 + 3 * e, cy + amp)
    ctx.lineTo(x0 + 5 * e, cy + amp)
    ctx.lineTo(x0 + 5 * e, cy - amp)
    ctx.lineTo(x0 + 7 * e, cy - amp)
    ctx.lineTo(x0 + 7 * e, cy)
    ctx.lineTo(x1, cy)
    ctx.stroke(opts.palette.pin, 1.5 * scale)
  }
}
