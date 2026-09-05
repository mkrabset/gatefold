import type { Port, Signal } from '../types'
import { inputPortId, outputPortId } from '../types'
import { countOutputs, drawBusTrapezoidLeft, Gate } from './gate'
import type { DrawOptions } from './primitive'
import type { VectorContext } from './vector'

/** Splits one n-wide bus input into n single-wire outputs. */
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

  transfer(inputs: Signal[][]): Signal[][] {
    // Split the n-wide bus input into n single-wire outputs.
    return inputs[0].map((b) => [b])
  }

  bodySize(): { w: number; h: number } {
    return { w: 56, h: 48 }
  }

  draw(ctx: VectorContext, opts: DrawOptions): void {
    drawBusTrapezoidLeft(ctx, opts, 8, 'in:0')
  }
}
