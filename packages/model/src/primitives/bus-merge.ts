import type { Port } from '../types'
import { inputPortId, outputPortId } from '../types'
import { Gate } from './gate'
import type { DrawOptions } from './primitive'
import type { VectorContext } from './vector'

/**
 * Merges two bus inputs of width m each into one bus output of width 2m. The widths
 * are derived from wiring via `deriveWidth`, never stored.
 */
export class BusMerge extends Gate {
  readonly kind = 'bus-merge' as const
  readonly label = 'BUS-MERGE'
  readonly glyph = '∪'
  readonly fixedInputs = true
  readonly fixedOutputs = true

  defaultPorts(): Port[] {
    return [
      { id: inputPortId(0), name: 'A', direction: 'input' },
      { id: inputPortId(1), name: 'B', direction: 'input' },
      { id: outputPortId(0), name: 'BUS', direction: 'output' },
    ]
  }

  deriveWidth(port: Port, siblings: ReadonlyMap<string, number>): number | null {
    if (port.direction === 'output') {
      const m = siblings.get('in:0') ?? siblings.get('in:1')
      return m === undefined ? null : 2 * m
    }
    const n = siblings.get('out:0')
    if (n !== undefined) return n / 2
    const other = port.id === 'in:0' ? siblings.get('in:1') : siblings.get('in:0')
    return other ?? null
  }

  undeterminedHint(port: Port): string | null {
    return port.direction === 'output' ? '2x?' : '?'
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
    // Trapezoid narrowing from the two inputs on the left toward the single bus output.
    ctx.beginPath()
    ctx.moveTo(l, t)
    ctx.lineTo(r, cy - 12)
    ctx.lineTo(r, cy + 12)
    ctx.lineTo(l, b)
    ctx.closePath()
    ctx.fill(palette.gateFill)
    ctx.stroke(palette.gateStroke, 1.5)
  }
}
