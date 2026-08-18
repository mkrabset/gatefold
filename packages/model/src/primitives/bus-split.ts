import type { Port } from '../types'
import { inputPortId, outputPortId } from '../types'
import { deriveBusWidth, drawBusTrapezoidLeft, Gate } from './gate'
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
    return deriveBusWidth(port, siblings, 'in:0', ['out:0', 'out:1'])
  }

  undeterminedHint(port: Port): string | null {
    return port.direction === 'input' ? '2x?' : '?'
  }

  bodySize(): { w: number; h: number } {
    return { w: 64, h: 56 }
  }

  draw(ctx: VectorContext, opts: DrawOptions): void {
    drawBusTrapezoidLeft(ctx, opts, 12, 'in:0')
  }
}
