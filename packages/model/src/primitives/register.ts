import type { Port, PropertyValue, Signal } from '../types'
import { inputPortId, outputPortId } from '../ports'
import { Gate, gateBounds } from './gate'
import type { DrawOptions, PropertySpec } from './primitive'
import type { VectorContext } from './vector'

/** Default register width (WIRE terminal type) when an instance has no explicit `width`. */
export const REGISTER_DEFAULT_WIDTH = 8

/** Maximum number of single-wire data inputs/outputs (WIRE terminal type). */
export const REGISTER_MAX_WIDTH = 32

/** Resolve an instance's register width from its `width` property, clamped to `[1, 32]`.
 *  A `width` below 1 (unset, zero, or non-numeric) falls back to the default. */
export function registerWidthOf(props: Record<string, PropertyValue> | undefined): number {
  const w = typeof props?.width === 'number' ? Math.floor(props.width) : 0
  return w >= 1 ? Math.min(REGISTER_MAX_WIDTH, w) : REGISTER_DEFAULT_WIDTH
}

/** The fixed bus width of a register's `DATA`/`Q` buses, or null when they adopt the
 *  connected width (`width` unset, zero, or non-numeric). Used only in BUS terminal type. */
export function registerBusWidth(props: Record<string, PropertyValue> | undefined): number | null {
  const w = typeof props?.width === 'number' ? Math.floor(props.width) : 0
  return w >= 1 ? Math.min(REGISTER_MAX_WIDTH, w) : null
}

/**
 * The terminal list for a register: fixed `CLK`/`RST` inputs (RST defaults to pull-down
 * so an unconnected reset reads inactive) plus a single `DATA` bus input and a single `Q`
 * bus output (BUS), or `width` single-wire `D0…` inputs and `Q0…` outputs (WIRE).
 */
export function registerPorts(terminalType: 'wire' | 'bus', width: number): Port[] {
  const inputs: Port[] = [
    { id: inputPortId(0), name: 'CLK', direction: 'input' },
    { id: inputPortId(1), name: 'RST', direction: 'input', pull: 'down' },
  ]
  const n = Math.max(1, Math.min(REGISTER_MAX_WIDTH, Math.floor(width)))
  if (terminalType === 'bus') {
    inputs.push({ id: inputPortId(2), name: 'DATA', direction: 'input' })
    return [...inputs, { id: outputPortId(0), name: 'Q', direction: 'output' }]
  }
  for (let i = 0; i < n; i++) inputs.push({ id: inputPortId(2 + i), name: `D${i}`, direction: 'input' })
  const outputs: Port[] = Array.from({ length: n }, (_, i) => ({
    id: outputPortId(i),
    name: `Q${i}`,
    direction: 'output' as const,
  }))
  return [...inputs, ...outputs]
}

/**
 * An n-bit register (an array of 1-bit memory cells): on each rising `CLK` edge the
 * register samples `DATA` (a bus, or one single-wire `D0…` input per bit), and an
 * asserted `RST` clears it to zero — synchronously (on the clock edge) or asynchronously
 * (immediately), per the `resetStyle` property. A *stateful* primitive (evaluated by the
 * simulator's sequential path), with a `Q` bus output (BUS) or `width` single-wire
 * `Q0…` outputs (WIRE). The `DATA` and `Q` buses always share one width (coupled via
 * `deriveWidth`): it is adopted from the connection when `width` is 0, else fixed to
 * `width` (pinned, so a mismatched connection conflicts).
 */
export class Register extends Gate {
  readonly kind = 'register' as const
  readonly label = 'REGISTER'
  readonly glyph = 'REG'
  readonly fixedInputs = true
  readonly fixedOutputs = true

  defaultPorts(): Port[] {
    return registerPorts('bus', REGISTER_DEFAULT_WIDTH)
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
      { name: 'terminalType', label: 'Terminal type', type: 'select', default: 'bus', options: ['wire', 'bus'] },
      { name: 'width', label: 'Width', type: 'number', default: 0, min: 0, max: REGISTER_MAX_WIDTH, tooltip: '0 = auto (the DATA/Q buses adopt the connected width; a WIRE register uses the default count). Otherwise the fixed register width (and, in WIRE mode, the number of data/output terminals).' },
    ]
  }

  deriveWidth(port: Port, siblings: ReadonlyMap<string, number>, _props?: Record<string, PropertyValue>): number | null {
    // The DATA bus and Q bus adopt each other's width (so a register's data-in and
    // data-out always agree); CLK/RST and the WIRE terminals are single-wire.
    if (port.name === 'DATA') return siblings.get('out:0') ?? null
    if (port.name === 'Q') return siblings.get('in:2') ?? null
    return 1
  }

  pinnedWidth(port: Port, props?: Record<string, PropertyValue>): number | null {
    // In BUS mode a `width` ≥ 1 pins both the DATA and Q buses (they always agree), so a
    // mismatched connection conflicts rather than being adopted.
    if (port.name === 'DATA' || port.name === 'Q') return registerBusWidth(props)
    return null
  }

  undeterminedHint(port: Port): string | null {
    return port.name === 'DATA' || port.name === 'Q' ? '?' : null
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
    // A small register glyph: two parallel bars (a stored bit).
    const scale = (b - t) / this.bodySize().h
    const s = 3 * scale
    const gap = 2 * scale
    ctx.beginPath()
    ctx.moveTo(cx - s, cy - gap)
    ctx.lineTo(cx + s, cy - gap)
    ctx.moveTo(cx - s, cy + gap)
    ctx.lineTo(cx + s, cy + gap)
    ctx.stroke(opts.palette.pin, 1.5 * scale)
  }
}
