import type { Port } from '../types'
import { inputPortId, outputPortId } from '../types'
import { deriveBusWidth, drawBusTrapezoidRight, Gate } from './gate'
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
    return deriveBusWidth(port, siblings, 'out:0', ['in:0', 'in:1'])
  }

  undeterminedHint(port: Port): string | null {
    return port.direction === 'output' ? '2x?' : '?'
  }

  bodySize(): { w: number; h: number } {
    return { w: 64, h: 56 }
  }

  draw(ctx: VectorContext, opts: DrawOptions): void {
    drawBusTrapezoidRight(ctx, opts, 12, 'out:0')
  }
}
