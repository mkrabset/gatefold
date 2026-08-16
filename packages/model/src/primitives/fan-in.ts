import type { Port } from '../types'
import { inputPortId, outputPortId } from '../types'
import { countInputs, Gate } from './gate'
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

  bodySize(): { w: number; h: number } {
    return { w: 56, h: 48 }
  }

  draw(ctx: VectorContext, opts: DrawOptions): void {
    const { x: cx, y: cy, w, h, palette } = opts
    const l = cx - w / 2
    const r = cx + w / 2
    const t = cy - h / 2
    const b = cy + h / 2
    // Trapezoid narrowing toward the bus output on the right.
    ctx.beginPath()
    ctx.moveTo(l, t)
    ctx.lineTo(r, cy - 8)
    ctx.lineTo(r, cy + 8)
    ctx.lineTo(l, b)
    ctx.closePath()
    ctx.fill(palette.gateFill)
    ctx.stroke(palette.gateStroke, 1.5)
  }
}
