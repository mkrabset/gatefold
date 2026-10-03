import type { Port, PropertyValue, Signal } from '../types'
import { inputPortId, outputPortId } from '../ports'
import { deriveBusWidth, deriveUnevenWidth, drawBusSplit, firstLanesOf, Gate } from './gate'
import type { DrawOptions, PropertySpec } from './primitive'
import type { VectorContext } from './vector'

/**
 * Splits one bus input (width n) into two bus outputs. By default the split is even
 * (`Y1`/`Y2` each n/2); the `firstLanes` property fixes `Y1` to that many lanes and
 * gives `Y2` the remainder (n − firstLanes). Widths are derived from wiring via
 * `deriveWidth`, never stored.
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

  properties(): PropertySpec[] {
    return [
      { name: 'firstLanes', label: 'First lanes', type: 'number', default: 0, min: 0, max: 64, tooltip: 'Number of lanes in the first output (Y1); the rest go to Y2. 0 = split evenly.' },
    ]
  }

  deriveWidth(port: Port, siblings: ReadonlyMap<string, number>, props?: Record<string, PropertyValue>): number | null {
    const first = firstLanesOf(props)
    if (first !== null) return deriveUnevenWidth(port, siblings, 'in:0', 'out:0', 'out:1', first)
    return deriveBusWidth(port, siblings, 'in:0', ['out:0', 'out:1'])
  }

  transfer(inputs: Signal[][], props?: Record<string, PropertyValue>): Signal[][] {
    const bits = inputs[0] ?? []
    const m = firstLanesOf(props) ?? Math.floor(bits.length / 2)
    return [bits.slice(0, m), bits.slice(m)]
  }

  undeterminedHint(port: Port): string | null {
    return port.direction === 'input' ? '2x?' : '?'
  }

  bodySize(): { w: number; h: number } {
    return { w: 64, h: 56 }
  }

  draw(ctx: VectorContext, opts: DrawOptions): void {
    drawBusSplit(ctx, opts, 12, 'in:0')
  }
}
