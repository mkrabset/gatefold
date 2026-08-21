import type { Port, PrimitiveKind, Signal } from '../types'
import { inputPortId, outputPortId } from '../types'
import type { DrawOptions, Palette, Primitive, PropertySpec } from './primitive'
import type { VectorContext } from './vector'

const INPUT_NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

export function countInputs(ports: Port[]): number {
  return ports.filter((p) => p.direction === 'input').length
}

export function countOutputs(ports: Port[]): number {
  return ports.filter((p) => p.direction === 'output').length
}

/** The fixed two-input/one-output terminal set shared by AND/OR/XOR. */
export function twoInputGatePorts(): Port[] {
  return [
    { id: inputPortId(0), name: 'A', direction: 'input' },
    { id: inputPortId(1), name: 'B', direction: 'input' },
    { id: outputPortId(0), name: 'Y', direction: 'output' },
  ]
}

/** The standard two-input gate body size (AND/OR/XOR). */
export function twoInputGateBody(): { w: number; h: number } {
  return { w: 64, h: 44 }
}

/** Body-corner coordinates derived from a draw call's options. */
export function gateBounds(opts: DrawOptions): { l: number; r: number; t: number; b: number; cx: number; cy: number } {
  const { x: cx, y: cy, w, h } = opts
  return { l: cx - w / 2, r: cx + w / 2, t: cy - h / 2, b: cy + h / 2, cx, cy }
}

/** Fill and stroke a closed path as a gate body. */
export function fillAndStroke(ctx: VectorContext, palette: Palette): void {
  ctx.fill(palette.gateFill)
  ctx.stroke(palette.gateStroke, 1.5)
}

/** Trapezoid narrowing toward a bus pin on the right (fan-in / bus-merge). */
export function drawBusTrapezoidRight(ctx: VectorContext, opts: DrawOptions, neckMin: number, portId: string): void {
  const { l, r, t, b, cy } = gateBounds(opts)
  const neck = Math.max(neckMin, opts.pinRadius?.(portId) ?? 0)
  ctx.beginPath()
  ctx.moveTo(l, t)
  ctx.lineTo(r, cy - neck)
  ctx.lineTo(r, cy + neck)
  ctx.lineTo(l, b)
  ctx.closePath()
  fillAndStroke(ctx, opts.palette)
}

/** Trapezoid widening from a bus pin on the left (fan-out / bus-split). */
export function drawBusTrapezoidLeft(ctx: VectorContext, opts: DrawOptions, neckMin: number, portId: string): void {
  const { l, r, t, b, cy } = gateBounds(opts)
  const neck = Math.max(neckMin, opts.pinRadius?.(portId) ?? 0)
  ctx.beginPath()
  ctx.moveTo(l, cy - neck)
  ctx.lineTo(r, t)
  ctx.lineTo(r, b)
  ctx.lineTo(l, cy + neck)
  ctx.closePath()
  fillAndStroke(ctx, opts.palette)
}

/**
 * Width derivation for the 2:1 bus relation (bus-split / bus-merge): the `doublePortId`
 * pin is twice the width of each of the two `halfPortIds` pins.
 */
export function deriveBusWidth(
  port: Port,
  siblings: ReadonlyMap<string, number>,
  doublePortId: string,
  halfPortIds: [string, string],
): number | null {
  if (port.id === doublePortId) {
    const m = siblings.get(halfPortIds[0]) ?? siblings.get(halfPortIds[1])
    return m === undefined ? null : 2 * m
  }
  const n = siblings.get(doublePortId)
  if (n !== undefined) return n / 2
  const other = port.id === halfPortIds[0] ? siblings.get(halfPortIds[1]) : siblings.get(halfPortIds[0])
  return other ?? null
}

/**
 * Base class for the single-wire logic gates (AND, OR, XOR, NOT, CLOCK, and the bus
 * FAN-IN/FAN-OUT). Supplies the defaults shared across them: variable inputs named A…
 * H, a fixed single output, no terminal renaming, navigable, width 1.
 */
export abstract class Gate implements Primitive {
  abstract readonly kind: PrimitiveKind
  abstract readonly label: string
  abstract readonly glyph: string
  readonly fixedInputs: boolean = false
  readonly fixedOutputs: boolean = true
  readonly allowRenameTerminals: boolean = false

  abstract defaultPorts(): Port[]
  abstract bodySize(): { w: number; h: number }
  abstract draw(ctx: VectorContext, opts: DrawOptions): void
  abstract transfer(inputs: Signal[][]): Signal[][]

  nextInputName(ports: Port[]): string | null {
    return INPUT_NAMES[countInputs(ports)] ?? null
  }

  isPortGroup(): boolean {
    return false
  }

  isNavigable(): boolean {
    return true
  }

  portGroupDirection(): 'input' | 'output' | null {
    return null
  }

  intrinsicWidth(_ports: Port[], _port: Port): number | null {
    return 1
  }

  properties(): PropertySpec[] {
    return []
  }
}
