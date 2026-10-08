import type { Port, PropertyValue, Signal } from '../types'
import { inputPortId, outputPortId } from '../ports'
import { Gate, gateBounds } from './gate'
import type { DrawOptions, PropertySpec } from './primitive'
import type { VectorContext } from './vector'

/** Default counting width (WIRE terminal type) when an instance has no explicit `width`. */
export const COUNTER_DEFAULT_WIDTH = 4

/** Maximum number of single-wire outputs (WIRE terminal type). */
export const COUNTER_MAX_WIDTH = 32

/** Resolve an instance's counter width from its `width` property, clamped to `[1, 32]`.
 *  A `width` below 1 (unset, zero, or non-numeric) falls back to the default. */
export function counterWidthOf(props: Record<string, PropertyValue> | undefined): number {
  const w = typeof props?.width === 'number' ? Math.floor(props.width) : 0
  return w >= 1 ? Math.min(COUNTER_MAX_WIDTH, w) : COUNTER_DEFAULT_WIDTH
}

/** The fixed bus width of a counter's `Q` bus, or null when the bus adopts the connected
 *  width (`width` unset, zero, or non-numeric). Used only in BUS terminal type. */
export function counterBusWidth(props: Record<string, PropertyValue> | undefined): number | null {
  const w = typeof props?.width === 'number' ? Math.floor(props.width) : 0
  return w >= 1 ? Math.min(COUNTER_MAX_WIDTH, w) : null
}

/**
 * The terminal list for a counter: fixed `CLK`/`RST` inputs (RST defaults to pull-down
 * so an unconnected reset reads inactive) plus a single neutral `Q` bus (BUS) or `width`
 * single-wire `Q0…` outputs (WIRE).
 */
export function counterPorts(terminalType: 'wire' | 'bus', width: number): Port[] {
  const inputs: Port[] = [
    { id: inputPortId(0), name: 'CLK', direction: 'input' },
    { id: inputPortId(1), name: 'RST', direction: 'input', pull: 'down' },
  ]
  const outputs: Port[] =
    terminalType === 'bus'
      ? [{ id: outputPortId(0), name: 'Q', direction: 'output' }]
      : Array.from({ length: Math.max(1, Math.min(COUNTER_MAX_WIDTH, Math.floor(width))) }, (_, i) => ({
          id: outputPortId(i),
          name: `Q${i}`,
          direction: 'output' as const,
        }))
  return [...inputs, ...outputs]
}

/**
 * An n-bit counter: on each rising `CLK` edge the count increments by one (wrapping at
 * 2^width), and an asserted `RST` resets it to zero — synchronously (on the clock edge)
 * or asynchronously (immediately), per the `resetStyle` property. A *stateful* primitive
 * (evaluated by the simulator's sequential path), with a `Q` bus output (BUS) or `width`
 * single-wire `Q0…` outputs (WIRE). In BUS mode the `Q` width is adopted from the
 * connection when `width` is 0, else fixed to `width`. Maps 1:1 to a `always @(posedge
 * clk)` counter in Verilog.
 */
export class Counter extends Gate {
  readonly kind = 'counter' as const
  readonly label = 'COUNTER'
  readonly glyph = '+1'
  readonly fixedInputs = true
  readonly fixedOutputs = true

  defaultPorts(): Port[] {
    return counterPorts('wire', COUNTER_DEFAULT_WIDTH)
  }

  nextInputName(): string | null {
    return null
  }

  isSequential(_props?: Record<string, PropertyValue>): boolean {
    return true
  }

  clockPortId(): string {
    return 'in:0'
  }

  resetPortId(): string {
    return 'in:1'
  }

  showTerminalNames(): boolean {
    return true
  }

  properties(): PropertySpec[] {
    return [
      { name: 'resetStyle', label: 'Reset', type: 'select', default: 'sync', options: ['sync', 'async'], tooltip: 'SYNC resets on the clock edge while RST is high; ASYNC resets immediately on RST.' },
      { name: 'terminalType', label: 'Terminal type', type: 'select', default: 'wire', options: ['wire', 'bus'] },
      { name: 'width', label: 'Width', type: 'number', default: 0, min: 0, max: COUNTER_MAX_WIDTH, tooltip: '0 = auto (a BUS output adopts the connected width; a WIRE output uses the default count). Otherwise the fixed counting width (and, in WIRE mode, the number of outputs).' },
    ]
  }

  intrinsicWidth(_ports: Port[], port: Port, props?: Record<string, PropertyValue>): number | null {
    // The BUS terminal is pinned to the `width` property when it is ≥ 1, else neutral
    // (adopts the connected width); CLK/RST and WIRE outputs are width 1.
    if (port.name === 'Q') return counterBusWidth(props)
    return 1
  }

  transfer(): Signal[][] {
    // Stateful (edge-triggered): driven by the simulator's sequential path.
    return []
  }

  bodySize(): { w: number; h: number } {
    return { w: 56, h: 48 }
  }

  draw(ctx: VectorContext, opts: DrawOptions): void {
    const { l, r, t, b, cx, cy } = gateBounds(opts)
    ctx.beginPath()
    ctx.roundRect(l, t, r - l, b - t, 6)
    ctx.fill(opts.palette.gateFill)
    ctx.stroke(opts.palette.gateStroke, 1.5)
    // A small "+" glyph (increment) centred in the body, scaled with the body height.
    const scale = (b - t) / this.bodySize().h
    const s = 3 * scale
    ctx.beginPath()
    ctx.moveTo(cx - s, cy)
    ctx.lineTo(cx + s, cy)
    ctx.moveTo(cx, cy - s)
    ctx.lineTo(cx, cy + s)
    ctx.stroke(opts.palette.pin, 1.5 * scale)
  }
}
