import type { Port, PrimitiveKind } from '../types'
import { inputPortId, outputPortId } from '../types'
import { Gate } from './gate'
import type { DrawOptions } from './primitive'
import type { VectorContext } from './vector'

/** A buffer: passes its single input through to its output unchanged. */
export class Buffer extends Gate {
  readonly kind: PrimitiveKind = 'buffer'
  readonly label: string = 'BUFFER'
  readonly glyph: string = '▷'
  readonly fixedInputs = true
  readonly fixedOutputs = true

  defaultPorts(): Port[] {
    return [
      { id: inputPortId(0), name: 'A', direction: 'input' },
      { id: outputPortId(0), name: 'Y', direction: 'output' },
    ]
  }

  bodySize(): { w: number; h: number } {
    return { w: 48, h: 44 }
  }

  draw(ctx: VectorContext, opts: DrawOptions): void {
    const { x: cx, y: cy, w, h, palette } = opts
    const l = cx - w / 2
    const r = cx + w / 2
    const t = cy - h / 2
    const b = cy + h / 2
    // Triangle with its apex at the right edge (the inversion bubble, if any, is
    // drawn by the renderer from the port's `inverted` flag).
    ctx.beginPath()
    ctx.moveTo(l, t)
    ctx.lineTo(r, cy)
    ctx.lineTo(l, b)
    ctx.closePath()
    ctx.fill(palette.gateFill)
    ctx.stroke(palette.gateStroke, 1.5)
  }
}
