import type { Port, Signal } from '../types'
import { inputPortId, outputPortId } from '../types'
import { Gate } from './gate'
import type { DrawOptions } from './primitive'
import type { VectorContext } from './vector'

/**
 * A single-wire join point: a filled dot whose one input terminal and one output
 * terminal coincide at the body center. It passes its input through unchanged, and
 * because a source pin can drive any number of sinks, multiple wires fan out from the
 * single output. Wires radiating from the dot collapse their nearest control point
 * onto the endpoint (handled by the app's router).
 */
export class JoinPoint extends Gate {
  readonly kind = 'join-point' as const
  readonly label = 'NODE'
  readonly glyph = '•'
  readonly fixedInputs = true
  readonly fixedOutputs = true
  readonly allowInversion = false

  defaultPorts(): Port[] {
    return [
      { id: inputPortId(0), name: 'A', direction: 'input' },
      { id: outputPortId(0), name: 'Y', direction: 'output' },
    ]
  }

  nextInputName(): string | null {
    return null
  }

  coincidentTerminals(): boolean {
    return true
  }

  transfer(inputs: Signal[][]): Signal[][] {
    return [inputs[0]]
  }

  bodySize(): { w: number; h: number } {
    return { w: 10, h: 10 }
  }

  draw(ctx: VectorContext, opts: DrawOptions): void {
    const r = Math.min(opts.w, opts.h) / 2
    ctx.beginPath()
    ctx.arc(opts.x, opts.y, r, 0, Math.PI * 2)
    ctx.fill(opts.palette.wire)
  }
}
