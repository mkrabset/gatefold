import type { Port, PrimitiveKind, PropertyValue, Signal } from '../types'
import { inputPortId } from '../ports'
import { Gate, fillAndStroke, gateBounds } from './gate'
import type { DrawOptions, PropertySpec } from './primitive'
import type { VectorContext } from './vector'

/** The edge condition that arms a probe's pause trigger. */
export type TriggerOn = 'RISING_EDGE' | 'FALLING_EDGE' | 'EDGE'

/** Resolve an instance's trigger condition from its `triggerOn` property (absent/unknown → RISING_EDGE). */
export function triggerOnOf(props?: Record<string, PropertyValue>): TriggerOn {
  return props?.triggerOn === 'FALLING_EDGE' || props?.triggerOn === 'EDGE' ? props.triggerOn : 'RISING_EDGE'
}

/** Whether an instance's `triggerPause` property is enabled (pauses the simulation on a trigger). */
export function triggerPauseOf(props?: Record<string, PropertyValue>): boolean {
  return props?.triggerPause === true
}

/**
 * A monitoring probe: a single input terminal that taps a wire (single) or bus and is
 * recorded by the simulator for the simulation timeline. It is a pure sink — it has no
 * outputs and does not affect the circuit. Its input adopts the connected width (neutral
 * single-wire or bus). Probes are excluded from grouping, so a probe selected alongside
 * real components stays in the parent sheet rather than moving into the new component.
 * When `triggerPause` is enabled, an edge on the input (per the `triggerOn` condition,
 * met on any lane of a bus) pauses a running simulation.
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

  properties(): PropertySpec[] {
    return [
      { name: 'triggerPause', label: 'Pause on trigger', type: 'boolean', default: false, tooltip: 'Pause a running simulation when this probe\'s input meets the trigger condition (any lane of a bus).' },
      { name: 'triggerOn', label: 'Trigger on', type: 'select', default: 'RISING_EDGE', options: ['RISING_EDGE', 'FALLING_EDGE', 'EDGE'], tooltip: 'The edge that arms the pause trigger: a 0→1 rising edge, a 1→0 falling edge, or either.' },
    ]
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
