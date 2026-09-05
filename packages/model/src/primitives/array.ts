import type { ChildDef, Port, PortDirection, Signal } from '../types'
import { inputPortId, outputPortId } from '../types'
import { Gate, gateBounds } from './gate'
import type { DrawOptions, PropertySpec } from './primitive'
import type { VectorContext } from './vector'

/** The primitive kind of a child def, or null when composite. */
function childKind(def: ChildDef): string | null {
  return def.kind === 'composite' ? null : def.primitive
}

/** True for the switch-array/led-array primitive defs. */
export function isArrayDef(def: ChildDef | undefined): boolean {
  const k = def ? childKind(def) : null
  return k === 'switch-array' || k === 'led-array'
}

/** Terminal direction of an array primitive (switch-array drives, led-array sinks). */
export function arrayDirection(def: ChildDef): PortDirection {
  return childKind(def) === 'switch-array' ? 'output' : 'input'
}

/** Port list for a switch-array/led-array: `size` single-wire ports, or one bus port. */
export function arrayPorts(direction: PortDirection, terminalType: 'wire' | 'bus', size: number): Port[] {
  if (terminalType === 'bus') {
    const id = direction === 'input' ? inputPortId(0) : outputPortId(0)
    return [{ id, name: 'BUS', direction }]
  }
  const n = Math.max(1, Math.min(32, Math.floor(size)))
  const ports: Port[] = []
  for (let i = 0; i < n; i++) {
    const id = direction === 'input' ? inputPortId(i) : outputPortId(i)
    ports.push({ id, name: direction === 'input' ? `A${i}` : `Y${i}`, direction })
  }
  return ports
}

/**
 * Base for the switch-array / led-array primitives. They share their property schema,
 * body size, neutral-BUS / width-1-WIRE terminals, sink/source `transfer`, and the
 * empty-box fallback `draw` (the app renderer draws the actual indicator body).
 */
export abstract class ArrayPrimitive extends Gate {
  nextInputName(): string | null {
    return null
  }

  properties(): PropertySpec[] {
    return [
      { name: 'terminalType', label: 'Terminal type', type: 'select', default: 'bus', options: ['wire', 'bus'] },
    ]
  }

  bodySize(): { w: number; h: number } {
    return { w: 56, h: 40 }
  }

  transfer(): Signal[][] {
    // Source/sink: driven/read per-lane by the simulator and renderer.
    return []
  }

  intrinsicWidth(_ports: Port[], port: Port): number | null {
    // The BUS terminal adopts the connected width (neutral); WIRE terminals are width 1.
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
