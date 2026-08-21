import type { Port, Signal } from '../types'
import { Gate, gateBounds } from './gate'
import { arrayPorts } from './array'
import type { DrawOptions, PropertySpec } from './primitive'
import type { VectorContext } from './vector'

/** An array of independent toggle switches (a multi-lane source). */
export class SwitchArray extends Gate {
  readonly kind = 'switch-array' as const
  readonly label = 'SWITCH-ARRAY'
  readonly glyph = '⏻'
  readonly fixedInputs = true
  readonly fixedOutputs = false

  defaultPorts(): Port[] {
    return arrayPorts('output', 'wire', 1)
  }

  nextInputName(): string | null {
    return null
  }

  properties(): PropertySpec[] {
    return [
      { name: 'terminalType', label: 'Terminal type', type: 'select', default: 'wire', options: ['wire', 'bus'] },
    ]
  }

  bodySize(): { w: number; h: number } {
    return { w: 56, h: 40 }
  }

  transfer(): Signal[][] {
    // Source: driven per-lane by the simulator.
    return []
  }

  intrinsicWidth(_ports: Port[], port: Port): number | null {
    // The BUS output adopts the connected width (neutral); WIRE outputs are fixed width 1.
    return port.name === 'BUS' ? null : 1
  }

  draw(ctx: VectorContext, opts: DrawOptions): void {
    // Empty-box fallback; the app renderer draws the actual array body.
    const { l, t } = gateBounds(opts)
    ctx.beginPath()
    ctx.roundRect(l, t, opts.w, opts.h, 6)
    ctx.stroke(opts.palette.gateStroke, 1.5)
  }
}
