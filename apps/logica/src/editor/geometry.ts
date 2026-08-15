import type { ComponentDef, Design, Instance, PinRef, PrimitiveKind } from '@logica/model'
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

const TERMINAL_MARGIN = 48
const PORT_HIT_RADIUS = 6

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

/** Bounding box of all instances in a composite, used to place its port terminals. */
export function contentBounds(instances: Instance[], design: Design): Bounds {
  if (instances.length === 0) {
    return { x: -120, y: -80, w: 240, h: 160 }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const inst of instances) {
    const b = instanceBounds(inst, design.defs[inst.defId])
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.w)
    maxY = Math.max(maxY, b.y + b.h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/**
 * Position of a composite's *own* port terminal (used when editing inside it):
 * inputs sit just left of the content bounds, outputs just right, evenly spaced.
 */
export function portTerminalPosition(def: ComponentDef, portId: string, bounds: Bounds): { x: number; y: number } {
  const inIdx = inputPorts(def).findIndex((p) => p.id === portId)
  if (inIdx >= 0) {
    const total = inputPorts(def).length
    const y = total <= 1 ? bounds.y + bounds.h / 2 : bounds.y + ((inIdx + 1) * bounds.h) / (total + 1)
    return { x: bounds.x - TERMINAL_MARGIN, y }
  }
  const outIdx = outputPorts(def).findIndex((p) => p.id === portId)
  const total = outputPorts(def).length
  const y = total <= 1 ? bounds.y + bounds.h / 2 : bounds.y + ((outIdx + 1) * bounds.h) / (total + 1)
  return { x: bounds.x + bounds.w + TERMINAL_MARGIN, y }
}

export interface PortHit {
  ref: PinRef
  direction: 'input' | 'output'
}

/**
 * Hit-test all connectable ports (instance pins and the composite's own terminals)
 * and return the nearest one within `PORT_HIT_RADIUS`, or null.
 */
export function hitTestPort(
  wx: number,
  wy: number,
  instances: Instance[],
  design: Design,
  def: ComponentDef,
): PortHit | null {
  let best: PortHit | null = null
  let bestDist = Infinity
  const consider = (ref: PinRef, pos: { x: number; y: number }, direction: 'input' | 'output') => {
    const d = Math.hypot(wx - pos.x, wy - pos.y)
    if (d <= PORT_HIT_RADIUS && d < bestDist) {
      bestDist = d
      best = { ref, direction }
    }
  }

  for (const inst of instances) {
    const instDef = design.defs[inst.defId]
    for (const p of inputPorts(instDef)) {
      consider({ kind: 'instance', instanceId: inst.id, portId: p.id }, portPosition(inst, instDef, p.id), 'input')
    }
    for (const p of outputPorts(instDef)) {
      consider({ kind: 'instance', instanceId: inst.id, portId: p.id }, portPosition(inst, instDef, p.id), 'output')
    }
  }

  if (def.kind === 'composite') {
    const bounds = contentBounds(instances, design)
    for (const p of def.ports) {
      consider({ kind: 'port', portId: p.id }, portTerminalPosition(def, p.id, bounds), p.direction)
    }
  }

  return best
}
