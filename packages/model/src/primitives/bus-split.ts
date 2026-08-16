import type { Port } from '../types'
import { inputPortId, outputPortId } from '../types'
import { Gate } from './gate'
import type { DrawOptions } from './primitive'
import type { VectorContext } from './vector'

/**
 * Splits one bus input (width n, even) into two bus outputs of width n/2 each. The
 * widths are derived from wiring via `deriveWidth`, never stored.
 */
export class BusSplit extends Gate {
  readonly kind = 'bus-split' as const
  readonly label = 'BUS-SPLIT'
  readonly glyph = '⊘'
  readonly fixedInputs = true
  readonly fixedOutputs = true

  defaultPorts(): Port[] {
    return [
      { id: inputPortId(0), name: 'BUS', direction: 'input' },
      { id: outputPortId(0), name: 'Y1', direction: 'output' },
      { id: outputPortId(1), name: 'Y2', direction: 'output' },
    ]
  }

  deriveWidth(port: Port, siblings: ReadonlyMap<string, number>): number | null {
    if (port.direction === 'input') {
      const m = siblings.get('out:0') ?? siblings.get('out:1')
      return m === undefined ? null : 2 * m
    }
    const n = siblings.get('in:0')
    if (n !== undefined) return n / 2
    const other = port.id === 'out:0' ? siblings.get('out:1') : siblings.get('out:0')
    return other ?? null
  }

  undeterminedHint(port: Port): string | null {
    return port.direction === 'input' ? '2x?' : '?'
  }

  bodySize(): { w: number; h: number } {
    return { w: 64, h: 56 }
  }

  draw(ctx: VectorContext, opts: DrawOptions): void {
    const { x: cx, y: cy, w, h, palette } = opts
    const l = cx - w / 2
    const r = cx + w / 2
    const t = cy - h / 2
    const b = cy + h / 2
    // Trapezoid widening from the single bus input on the left toward the two outputs;
    // the neck grows with the bus pin so the terminal stays flush within the shape.
    const neck = Math.max(12, opts.pinRadius?.('in:0') ?? 0)
    ctx.beginPath()
    ctx.moveTo(l, cy - neck)
    ctx.lineTo(r, t)
    ctx.lineTo(r, b)
    ctx.lineTo(l, cy + neck)
    ctx.closePath()
    ctx.fill(palette.gateFill)
    ctx.stroke(palette.gateStroke, 1.5)
  }
}
