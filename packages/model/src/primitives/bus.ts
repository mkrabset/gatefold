import type { Port, PropertyValue, Signal } from '../types'
import { inputPortId, outputPortId } from '../types'
import { Gate, gateBounds } from './gate'
import type { DrawOptions, PropertySpec } from './primitive'
import type { VectorContext } from './vector'

/** A bus passthrough that fixes the width of its input and output to a `lanes` value. */
export class Bus extends Gate {
  readonly kind = 'bus' as const
  readonly label = 'BUS'
  readonly glyph = '≡'
  readonly fixedInputs = true
  readonly fixedOutputs = true

  defaultPorts(): Port[] {
    return [
      { id: inputPortId(0), name: 'A', direction: 'input' },
      { id: outputPortId(0), name: 'Y', direction: 'output' },
    ]
  }

  nextInputName(): string | null {
    return null
  }

  properties(): PropertySpec[] {
    return [
      { name: 'lanes', label: 'Lanes', type: 'number', default: 8, min: 1, max: 32 },
    ]
  }

  intrinsicWidth(_ports: Port[], _port: Port, props?: Record<string, PropertyValue>): number {
    const lanes = typeof props?.lanes === 'number' ? props.lanes : 8
    return Math.max(1, Math.floor(lanes))
  }

  transfer(inputs: Signal[][]): Signal[][] {
    return [inputs[0] ?? []]
  }

  bodySize(): { w: number; h: number } {
    return { w: 48, h: 40 }
  }

  draw(ctx: VectorContext, opts: DrawOptions): void {
    const { l, r, t, b, cy } = gateBounds(opts)
    ctx.beginPath()
    ctx.roundRect(l, t, r - l, b - t, 6)
    ctx.fill(opts.palette.gateFill)
    ctx.stroke(opts.palette.gateStroke, 1.5)
    // Three horizontal strokes to read as a bus.
    for (const dy of [-4, 0, 4]) {
      ctx.beginPath()
      ctx.moveTo(l + 6, cy + dy)
      ctx.lineTo(r - 6, cy + dy)
      ctx.stroke(opts.palette.gateStroke, 1)
    }
  }
}
