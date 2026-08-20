import type { Port, Signal } from '../types'
import { inputPortId, outputPortId } from '../types'
import { countInputs, drawBusTrapezoidRight, Gate } from './gate'
import type { DrawOptions } from './primitive'
import type { VectorContext } from './vector'

/** Bundles n single-wire inputs into one n-wide bus output. */
export class FanIn extends Gate {
  readonly kind = 'fan-in' as const
  readonly label = 'FAN-IN'
  readonly glyph = '≫'

  defaultPorts(): Port[] {
    return [
      { id: inputPortId(0), name: 'A', direction: 'input' },
      { id: inputPortId(1), name: 'B', direction: 'input' },
      { id: outputPortId(0), name: 'BUS', direction: 'output' },
    ]
  }

  intrinsicWidth(ports: Port[], port: Port): number {
    return port.direction === 'output' ? countInputs(ports) : 1
  }

  transfer(inputs: Signal[][]): Signal[][] {
    // Bundle the n single-wire inputs into one n-wide bus output.
    return [inputs.flat()]
  }

  bodySize(): { w: number; h: number } {
    return { w: 56, h: 48 }
  }

  draw(ctx: VectorContext, opts: DrawOptions): void {
    drawBusTrapezoidRight(ctx, opts, 8, 'out:0')
  }
}
