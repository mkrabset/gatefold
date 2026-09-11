import type { Port, Signal } from '../types'
import { inputPortId, outputPortId } from '../ports'
import { Gate, fillAndStroke, gateBounds } from './gate'
import type { DrawOptions } from './primitive'
import type { VectorContext } from './vector'

/**
 * Compares two buses of equal derived width: the single output is `1` when the two
 * input values match, `0` when they differ, and `'x'` when either carries an unknown
 * bit. The input widths are derived, never stored — both adopt the same width (neither
 * is fixed), mirroring the bus-split/bus-merge relations; the output is a single wire.
 */
export class Compare extends Gate {
  readonly kind = 'compare' as const
  readonly label = 'COMPARE'
  readonly glyph = '='
  readonly fixedInputs = true
  readonly fixedOutputs = true

  defaultPorts(): Port[] {
    return [
      { id: inputPortId(0), name: 'A', direction: 'input' },
      { id: inputPortId(1), name: 'B', direction: 'input' },
      { id: outputPortId(0), name: 'EQ', direction: 'output' },
    ]
  }

  nextInputName(): string | null {
    return null
  }

  deriveWidth(port: Port, siblings: ReadonlyMap<string, number>): number | null {
    // The output is a single wire; each input equals the other input's width.
    if (port.direction === 'output') return 1
    const other = siblings.get(port.id === 'in:0' ? 'in:1' : 'in:0')
    return other ?? null
  }

  transfer(inputs: Signal[][]): Signal[][] {
    const a = inputs[0] ?? []
    const b = inputs[1] ?? []
    const n = Math.max(a.length, b.length)
    let unknown = false
    for (let i = 0; i < n; i++) {
      const x = a[i] ?? 'x'
      const y = b[i] ?? 'x'
      if (x === 'x' || y === 'x') {
        unknown = true
        continue
      }
      if (x !== y) return [[0]]
    }
    return [[unknown ? 'x' : 1]]
  }

  undeterminedHint(port: Port): string | null {
    return port.direction === 'output' ? null : '?'
  }

  bodySize(): { w: number; h: number } {
    return { w: 64, h: 48 }
  }

  draw(ctx: VectorContext, opts: DrawOptions): void {
    const { l, r, t, b, cx, cy } = gateBounds(opts)
    ctx.beginPath()
    ctx.roundRect(l, t, r - l, b - t, 6)
    fillAndStroke(ctx, opts.palette)
    // An equals sign reads as "match".
    const half = (r - l) * 0.3
    const off = (b - t) * 0.16
    for (const s of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(cx - half, cy + s * off)
      ctx.lineTo(cx + half, cy + s * off)
      ctx.stroke(opts.palette.gateStroke, 1.5)
    }
  }
}
