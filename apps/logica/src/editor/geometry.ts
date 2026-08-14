import type { ComponentDef, Instance, PrimitiveKind } from '@logica/model'
import { inputPorts, outputPorts } from '@logica/model'

/**
 * Geometry helpers for the canvas: component sizes, port placement, and hit-testing.
 * All coordinates are in world space (pre-zoom); the renderer converts to screen space.
 */

const PRIMITIVE_SIZE: Record<PrimitiveKind, { w: number; h: number }> = {
  and: { w: 64, h: 44 },
  or: { w: 64, h: 44 },
  xor: { w: 64, h: 44 },
  not: { w: 48, h: 44 },
  clock: { w: 46, h: 46 },
}

export function defBodySize(def: ComponentDef): { w: number; h: number } {
  if (def.kind === 'primitive' && def.primitive) {
    return PRIMITIVE_SIZE[def.primitive]
  }
  return { w: 88, h: 56 }
}

/**
 * World position of a port pin on an instance. Inputs are distributed along the left
 * edge and outputs along the right edge. A single port sits at the vertical center;
 * otherwise ports are evenly spaced with equal gaps above/below the first and last.
 */
export function portPosition(
  instance: Instance,
  def: ComponentDef,
  portId: string,
): { x: number; y: number } {
  const { w, h } = defBodySize(def)
  const inIdx = inputPorts(def).findIndex((p) => p.id === portId)
  if (inIdx >= 0) {
    const total = inputPorts(def).length
    const y = total <= 1 ? instance.pos.y : instance.pos.y - h / 2 + ((inIdx + 1) * h) / (total + 1)
    return { x: instance.pos.x - w / 2, y }
  }
  const outIdx = outputPorts(def).findIndex((p) => p.id === portId)
  const total = outputPorts(def).length
  const y = total <= 1 ? instance.pos.y : instance.pos.y - h / 2 + ((outIdx + 1) * h) / (total + 1)
  return { x: instance.pos.x + w / 2, y }
}

export interface Bounds {
  x: number
  y: number
  w: number
  h: number
}

export function instanceBounds(instance: Instance, def: ComponentDef, pad = 0): Bounds {
  const { w, h } = defBodySize(def)
  return {
    x: instance.pos.x - w / 2 - pad,
    y: instance.pos.y - h / 2 - pad,
    w: w + pad * 2,
    h: h + pad * 2,
  }
}

/** Return the topmost instance whose padded bounds contain the world point, if any. */
export function hitTest(
  wx: number,
  wy: number,
  instances: Instance[],
  defs: Record<string, ComponentDef>,
): Instance | null {
  for (let i = instances.length - 1; i >= 0; i--) {
    const inst = instances[i]
    const def = defs[inst.defId]
    const b = instanceBounds(inst, def, 4)
    if (wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h) {
      return inst
    }
  }
  return null
}
