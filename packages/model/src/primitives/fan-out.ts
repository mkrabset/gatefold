import type { Port, PropertyValue, Signal } from '../types'
import { inputPortId, outputPortId } from '../ports'
import { countOutputs, drawBusTrapezoidLeft, Gate, sumLaneWidths, sumResolvedWidths } from './gate'
import type { DrawOptions } from './primitive'
import type { VectorContext } from './vector'

/** Splits one bus input into outputs whose widths sum to the input's width. */
export class FanOut extends Gate {
  readonly kind = 'fan-out' as const
  readonly label = 'FAN-OUT'
  readonly glyph = '≪'
  readonly fixedInputs = true
  readonly fixedOutputs = false

  defaultPorts(): Port[] {
    return [
      { id: inputPortId(0), name: 'BUS', direction: 'input' },
      { id: outputPortId(0), name: 'Y1', direction: 'output' },
      { id: outputPortId(1), name: 'Y2', direction: 'output' },
      { id: outputPortId(2), name: 'Y3', direction: 'output' },
      { id: outputPortId(3), name: 'Y4', direction: 'output' },
    ]
  }

  nextInputName(): string | null {
    return null
  }

  intrinsicWidth(ports: Port[], port: Port): number {
    return port.direction === 'input' ? countOutputs(ports) : 1
  }

  deriveWidth(port: Port, siblings: ReadonlyMap<string, number>, _props?: Record<string, PropertyValue>, ports?: Port[]): number | null {
    // An output lane adopts its connected width (a single wire or a sub-bus).
    if (port.direction === 'output') return null
    // The bus input is split across every output's bits: the sum of their widths,
    // undetermined until every lane is known.
    return sumLaneWidths(siblings, ports ?? [], 'output')
  }

  defaultWidth(port: Port): number | null {
    // A floating lane is a single wire; the bus input is derived, not defaulted.
    return port.direction === 'output' ? 1 : null
  }

  transfer(inputs: Signal[][], _props?: Record<string, PropertyValue>, outputWidths?: number[]): Signal[][] {
    // Split the input bus into chunks of the given output widths (single bits by default).
    const bits = inputs[0] ?? []
    if (!outputWidths || outputWidths.length === 0) return bits.map((b) => [b])
    let offset = 0
    return outputWidths.map((w) => {
      const chunk = bits.slice(offset, offset + w)
      offset += w
      return chunk
    })
  }

  widthError(port: Port, width: number, siblings?: ReadonlyMap<string, number>): string | null {
    // The bus input must equal the sum of its output lanes' widths.
    if (port.direction !== 'input') return null
    return sumResolvedWidths(siblings) === width ? null : 'Bus width mismatch'
  }

  bodySize(): { w: number; h: number } {
    return { w: 56, h: 48 }
  }

  draw(ctx: VectorContext, opts: DrawOptions): void {
    drawBusTrapezoidLeft(ctx, opts, 8, 'in:0')
  }
}
