import type { Port, PropertyValue, Signal } from '../types'
import { inputPortId, outputPortId } from '../ports'
import { countInputs, drawBusTrapezoidRight, Gate, sumLaneWidths, sumResolvedWidths } from './gate'
import type { DrawOptions } from './primitive'
import type { VectorContext } from './vector'

/** Bundles n inputs into one bus output whose width is the sum of the inputs' widths. */
export class FanIn extends Gate {
  readonly kind = 'fan-in' as const
  readonly label = 'FAN-IN'
  readonly glyph = '≫'

  defaultPorts(): Port[] {
    return [
      { id: inputPortId(0), name: 'A', direction: 'input' },
      { id: inputPortId(1), name: 'B', direction: 'input' },
      { id: inputPortId(2), name: 'C', direction: 'input' },
      { id: inputPortId(3), name: 'D', direction: 'input' },
      { id: outputPortId(0), name: 'BUS', direction: 'output' },
    ]
  }

  intrinsicWidth(ports: Port[], port: Port): number {
    return port.direction === 'output' ? countInputs(ports) : 1
  }

  deriveWidth(port: Port, siblings: ReadonlyMap<string, number>, _props?: Record<string, PropertyValue>, ports?: Port[]): number | null {
    // An input lane adopts its connected width (a single wire or a sub-bus).
    if (port.direction === 'input') return null
    // The bus output is the concatenation of every input's bits: the sum of their widths,
    // undetermined until every lane is known.
    return sumLaneWidths(siblings, ports ?? [], 'input')
  }

  defaultWidth(port: Port): number | null {
    // A floating lane is a single wire; the bus output is derived, not defaulted.
    return port.direction === 'input' ? 1 : null
  }

  transfer(inputs: Signal[][]): Signal[][] {
    // Concatenate every input's bits (sub-buses included) into the one bus output.
    return [inputs.flat()]
  }

  widthError(port: Port, width: number, siblings?: ReadonlyMap<string, number>): string | null {
    // The bus output must equal the sum of its input lanes' widths.
    if (port.direction !== 'output') return null
    return sumResolvedWidths(siblings) === width ? null : 'Bus width mismatch'
  }

  bodySize(): { w: number; h: number } {
    return { w: 56, h: 48 }
  }

  draw(ctx: VectorContext, opts: DrawOptions): void {
    drawBusTrapezoidRight(ctx, opts, 8, 'out:0')
  }
}
