import type { Port, PropertyValue, Signal } from '../types'
import { inputPortId, outputPortId } from '../ports'
import { deriveBusWidth, deriveUnevenWidth, drawBusMerge, firstLanesOf, Gate } from './gate'
import type { DrawOptions, PropertySpec } from './primitive'
import type { VectorContext } from './vector'

/**
 * Merges two bus inputs into one bus output. By default the two inputs are equal
 * (`A`/`B` each m); the `firstLanes` property fixes `A` to that many lanes and gives
 * `B` the remainder (output − firstLanes). The widths are derived from wiring via
 * `deriveWidth`, never stored.
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

  properties(): PropertySpec[] {
    return [
      { name: 'firstLanes', label: 'First lanes', type: 'number', default: 0, min: 0, max: 64, tooltip: 'Number of lanes in the first input (A); the rest come from B. 0 = merge evenly.' },
    ]
  }

  deriveWidth(port: Port, siblings: ReadonlyMap<string, number>, props?: Record<string, PropertyValue>): number | null {
    const first = firstLanesOf(props)
    if (first !== null) return deriveUnevenWidth(port, siblings, 'out:0', 'in:0', 'in:1', first)
    return deriveBusWidth(port, siblings, 'out:0', ['in:0', 'in:1'])
  }

  transfer(inputs: Signal[][]): Signal[][] {
    return [[...inputs[0], ...inputs[1]]]
  }

  undeterminedHint(port: Port): string | null {
    return port.direction === 'output' ? '2x?' : '?'
  }

  bodySize(): { w: number; h: number } {
    return { w: 64, h: 56 }
  }

  draw(ctx: VectorContext, opts: DrawOptions): void {
    drawBusMerge(ctx, opts, 12, 'out:0')
  }
}
