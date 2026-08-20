import type { ComponentDef, Design, Instance, PinRef, Port } from '@logica/model'
import { inputPorts, isNeutralPin, isPortGroupDef, outputPorts, pinWidth, portGroupDirection, primitiveOf, undeterminedHint } from '@logica/model'

export { isNeutralPin, pinWidth, undeterminedHint }

/**
 * Geometry helpers for the canvas: component sizes, port placement, and hit-testing.
 * All coordinates are in world space (pre-zoom); the renderer converts to screen space.
 *
 * Composite ports are represented by a single `input-port` / `output-port` instance
 * whose pins are *derived* from the enclosing composite's ports. Functions that need
 * those pins therefore take `parentDef` (the composite currently being edited).
 *
 * Terminal placement stacks each side's markers top-to-bottom with a constant gap
 * between adjacent markers and a fixed padding at the top and bottom, so a bus does
 * not dictate the spacing of its single-wire neighbours. Body heights grow to fit the
 * taller of the two sides.
 */

const PORT_GROUP_W = 56
const PORT_HIT_RADIUS = 6
/** Fixed edge-to-edge gap between adjacent terminal markers. */
const TERMINAL_GAP = 4
/** Fixed extra space at the top and bottom of a terminal-bearing side. */
const SIDE_PADDING = 6

/** Pin marker half-height in world units (pre-zoom) for a terminal of the given width.
 *  Scales linearly so each bus lane keeps a constant pitch. */
export function pinRadiusWorld(width: number): number {
  return 3.5 * width
}

/** World-space vertical offsets for each lane of a bus, inset one lane from each end
 *  of the marker (spread as if the bus were `width + 2` lanes wide). */
export function busWireOffsets(width: number): number[] {
  if (width <= 1) return [0]
  const r = pinRadiusWorld(width)
  const pitch = (2 * r) / (width + 1)
  return Array.from({ length: width }, (_, i) => -r + pitch * (i + 1))
}

/** The resolved widths (one per port, in order) of a side's terminals. */
function widthsOf(design: Design, parentDef: ComponentDef, instanceId: string, ports: Port[]): number[] {
  return ports.map((p) => pinWidth(design, parentDef, { instanceId, portId: p.id }))
}

/** Total height of a terminal side: its markers stacked with a constant gap, plus
 *  fixed padding at the top and bottom. */
export function sideHeight(widths: number[]): number {
  if (widths.length === 0) return 0
  const markers = widths.reduce((sum, w) => sum + 2 * pinRadiusWorld(w), 0)
  return 2 * SIDE_PADDING + markers + (widths.length - 1) * TERMINAL_GAP
}

/** World y of the `index`-th terminal, relative to the side's center (which coincides
 *  with the instance's center). */
export function sidePinOffset(widths: number[], index: number): number {
  const h = sideHeight(widths)
  let y = -h / 2 + SIDE_PADDING
  for (let i = 0; i < index; i++) y += 2 * pinRadiusWorld(widths[i]) + TERMINAL_GAP
  return y + pinRadiusWorld(widths[index])
}

/** The base body size of a def (before accounting for pin radii). */
export function defBodySize(def: ComponentDef): { w: number; h: number } {
  if (def.kind === 'primitive' && def.primitive) {
    return primitiveOf(def.primitive).bodySize()
  }
  return { w: 88, h: 56 }
}

/** Effective size of a port-group rectangle, accounting for its terminal markers. */
export function sizeForPorts(widths: number[]): { w: number; h: number } {
  return { w: PORT_GROUP_W, h: Math.max(28, sideHeight(widths)) }
}

/** Effective body size of an instance (port group or normal), accounting for pin radii. */
export function instanceBodySize(
  design: Design,
  parentDef: ComponentDef,
  instance: Instance,
  def: ComponentDef,
): { w: number; h: number } {
  if (isPortGroupDef(def)) {
    const isInput = portGroupDirection(def) === 'input'
    const ports = isInput ? inputPorts(parentDef) : outputPorts(parentDef)
    return sizeForPorts(widthsOf(design, parentDef, instance.id, ports))
  }
  const base = defBodySize(def)
  const inH = sideHeight(widthsOf(design, parentDef, instance.id, inputPorts(def)))
  const outH = sideHeight(widthsOf(design, parentDef, instance.id, outputPorts(def)))
  return { w: base.w, h: Math.max(base.h, inH, outH) }
}

/**
 * World position of a port pin on an instance. For a normal instance, inputs are
 * stacked along the left edge and outputs along the right. For a port group, the pins
 * come from the parent composite's ports of the matching direction (inputs on the
 * right edge for `input-port`, on the left for `output-port`).
 */
export function portPosition(
  design: Design,
  parentDef: ComponentDef,
  instance: Instance,
  def: ComponentDef,
  portId: string,
): { x: number; y: number } {
  if (isPortGroupDef(def)) {
    const isInput = portGroupDirection(def) === 'input'
    const ports = isInput ? inputPorts(parentDef) : outputPorts(parentDef)
    const idx = ports.findIndex((p) => p.id === portId)
    const widths = widthsOf(design, parentDef, instance.id, ports)
    const { w } = sizeForPorts(widths)
    const y = instance.pos.y + sidePinOffset(widths, idx)
    return { x: instance.pos.x + (isInput ? w / 2 : -w / 2), y }
  }

  const { w } = instanceBodySize(design, parentDef, instance, def)
  const inIdx = inputPorts(def).findIndex((p) => p.id === portId)
  if (inIdx >= 0) {
    const widths = widthsOf(design, parentDef, instance.id, inputPorts(def))
    return { x: instance.pos.x - w / 2, y: instance.pos.y + sidePinOffset(widths, inIdx) }
  }
  const outIdx = outputPorts(def).findIndex((p) => p.id === portId)
  const widths = widthsOf(design, parentDef, instance.id, outputPorts(def))
  return { x: instance.pos.x + w / 2, y: instance.pos.y + sidePinOffset(widths, outIdx) }
}

export interface Bounds {
  x: number
  y: number
  w: number
  h: number
}

export function instanceBounds(design: Design, parentDef: ComponentDef, instance: Instance, def: ComponentDef, pad = 0): Bounds {
  const { w, h } = instanceBodySize(design, parentDef, instance, def)
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
  design: Design,
  parentDef: ComponentDef,
): Instance | null {
  for (let i = instances.length - 1; i >= 0; i--) {
    const inst = instances[i]
    const def = design.defs[inst.defId]
    if (!def) continue
    const b = instanceBounds(design, parentDef, inst, def, 4)
    if (wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h) {
      return inst
    }
  }
  return null
}

export interface PortHit {
  ref: PinRef
  role: 'source' | 'sink'
}

/**
 * Hit-test all connectable pins and return the nearest one within the hit radius.
 * The role is derived directly from pin direction (output = source, input = sink).
 */
export function hitTestPort(
  wx: number,
  wy: number,
  instances: Instance[],
  design: Design,
  parentDef: ComponentDef,
): PortHit | null {
  let best: PortHit | null = null
  let bestDist = Infinity
  const consider = (ref: PinRef, pos: { x: number; y: number }, role: 'source' | 'sink') => {
    // Distance to the terminal marker (a vertical segment of half-height r): anywhere
    // along the marker counts, not just its centre.
    const r = pinRadiusWorld(pinWidth(design, parentDef, ref))
    let d: number
    if (wy < pos.y - r) d = Math.hypot(wx - pos.x, wy - (pos.y - r))
    else if (wy > pos.y + r) d = Math.hypot(wx - pos.x, wy - (pos.y + r))
    else d = Math.abs(wx - pos.x)
    if (d <= PORT_HIT_RADIUS && d < bestDist) {
      bestDist = d
      best = { ref, role }
    }
  }

  for (const inst of instances) {
    const def = design.defs[inst.defId]
    if (!def) continue
    const dir = portGroupDirection(def)
    if (dir === 'input') {
      for (const p of inputPorts(parentDef)) {
        consider({ instanceId: inst.id, portId: p.id }, portPosition(design, parentDef, inst, def, p.id), 'source')
      }
    } else if (dir === 'output') {
      for (const p of outputPorts(parentDef)) {
        consider({ instanceId: inst.id, portId: p.id }, portPosition(design, parentDef, inst, def, p.id), 'sink')
      }
    } else {
      for (const p of outputPorts(def)) {
        consider({ instanceId: inst.id, portId: p.id }, portPosition(design, parentDef, inst, def, p.id), 'source')
      }
      for (const p of inputPorts(def)) {
        consider({ instanceId: inst.id, portId: p.id }, portPosition(design, parentDef, inst, def, p.id), 'sink')
      }
    }
  }

  return best
}
