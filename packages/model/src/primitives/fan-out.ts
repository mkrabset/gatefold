import type { Port } from '../types'
import { inputPortId, outputPortId } from '../types'
import { countOutputs, Gate } from './gate'
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
    ]
  }

  nextInputName(): string | null {
    return null
  }

  intrinsicWidth(ports: Port[], port: Port): number {
    return port.direction === 'input' ? countOutputs(ports) : 1
  }

  bodySize(): { w: number; h: number } {
    return { w: 56, h: 48 }
  }

  draw(ctx: VectorContext, opts: DrawOptions): void {
    const { x: cx, y: cy, w, h, palette } = opts
    const l = cx - w / 2
    const r = cx + w / 2
    const t = cy - h / 2
    const b = cy + h / 2
    // Trapezoid widening from the bus input on the left toward the outputs; the neck
    // grows with the bus pin so the terminal stays flush within the shape.
    const neck = Math.max(8, opts.pinRadius?.('in:0') ?? 0)
    ctx.beginPath()
    ctx.moveTo(l, cy - neck)
    ctx.lineTo(r, t)
    ctx.lineTo(r, b)
    ctx.lineTo(l, cy + neck)
    ctx.closePath()
    ctx.fill(palette.gateFill)
    ctx.stroke(palette.gateStroke, 1.5)
  }
}
