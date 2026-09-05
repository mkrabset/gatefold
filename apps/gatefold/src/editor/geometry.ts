import type { ChildDef, CompositeDef, Instance, PinRef, Port } from '@gatefold/model'
import { childPorts, childPrimitive, inputPorts, isPortGroupDef, outputPorts, pinWidth, portGroupDirection, primitiveOf, resolvedPinWidth, sevenSegModeOf, sevenSegPositionCount } from '@gatefold/model'

export { isNeutralPin, pinWidth, resolvedPinWidth, undeterminedHint } from '@gatefold/model'

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

/** Seven-segment digit metrics (world units), shared with the renderer. */
export const SEVEN_SEG_DIGIT_W = 32
export const SEVEN_SEG_DIGIT_H = 56
export const SEVEN_SEG_GAP = 8
export const SEVEN_SEG_PAD = 8

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
function widthsOf(parentDef: CompositeDef, instanceId: string, ports: Port[]): number[] {
  return ports.map((p) => pinWidth(parentDef, { instanceId, portId: p.id }))
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
export function defBodySize(def: ChildDef): { w: number; h: number } {
  const k = childPrimitive(def)
  if (k) return primitiveOf(k).bodySize()
  return { w: 88, h: 56 }
}

/** Effective size of a port-group rectangle, accounting for its terminal markers. */
export function sizeForPorts(widths: number[]): { w: number; h: number } {
  return { w: PORT_GROUP_W, h: Math.max(28, sideHeight(widths)) }
}

/** Resolved bus width of a seven-seg input, or null when undetermined. */
export function sevenSegLaneCount(
  parentDef: CompositeDef,
  instance: Instance,
  def: ChildDef,
): number | null {
  const input = inputPorts(childPorts(def))[0]
  if (!input) return null
  return resolvedPinWidth(parentDef, { instanceId: instance.id, portId: input.id })
}

/** Effective body size of an instance (port group or normal), accounting for pin radii. */
export function instanceBodySize(
  parentDef: CompositeDef,
  instance: Instance,
  def: ChildDef,
): { w: number; h: number } {
  if (isPortGroupDef(def)) {
    const isInput = portGroupDirection(def) === 'input'
    const ports = isInput ? inputPorts(parentDef.ports) : outputPorts(parentDef.ports)
    return sizeForPorts(widthsOf(parentDef, instance.id, ports))
  }
  const k = childPrimitive(def)
  if (k === 'seven-seg') {
    const lanes = sevenSegLaneCount(parentDef, instance, def)
    const mode = sevenSegModeOf(instance.props)
    const positions = lanes === null ? 1 : sevenSegPositionCount(lanes, mode)
    const w = 2 * SEVEN_SEG_PAD + positions * SEVEN_SEG_DIGIT_W + (positions - 1) * SEVEN_SEG_GAP
    const inH = sideHeight(widthsOf(parentDef, instance.id, inputPorts(childPorts(def))))
    return { w, h: Math.max(SEVEN_SEG_DIGIT_H + 2 * SEVEN_SEG_PAD, inH) }
  }
  if (k && primitiveOf(k).coincidentTerminals?.()) {
    // A join-point's coincident terminals never inflate the body: it stays a dot.
    return defBodySize(def)
  }
  const base = defBodySize(def)
  const inH = sideHeight(widthsOf(parentDef, instance.id, inputPorts(childPorts(def))))
  const outH = sideHeight(widthsOf(parentDef, instance.id, outputPorts(childPorts(def))))
  return { w: base.w, h: Math.max(base.h, inH, outH) }
}

/**
 * World position of a port pin on an instance. For a normal instance, inputs are
 * stacked along the left edge and outputs along the right. For a port group, the pins
 * come from the parent composite's ports of the matching direction (inputs on the
 * right edge for `input-port`, on the left for `output-port`).
 */
export function portPosition(
  parentDef: CompositeDef,
  instance: Instance,
  def: ChildDef,
  portId: string,
): { x: number; y: number } {
  if (isPortGroupDef(def)) {
    const isInput = portGroupDirection(def) === 'input'
    const ports = isInput ? inputPorts(parentDef.ports) : outputPorts(parentDef.ports)
    const idx = ports.findIndex((p) => p.id === portId)
    const widths = widthsOf(parentDef, instance.id, ports)
    const { w } = sizeForPorts(widths)
    const y = instance.pos.y + sidePinOffset(widths, idx)
    return { x: instance.pos.x + (isInput ? w / 2 : -w / 2), y }
  }

  // Coincident terminals (the join-point dot): every pin sits at the body center.
  const k = childPrimitive(def)
  if (k && primitiveOf(k).coincidentTerminals?.()) {
    return { x: instance.pos.x, y: instance.pos.y }
  }

  const { w } = instanceBodySize(parentDef, instance, def)
  const ports = childPorts(def)
  const inIdx = inputPorts(ports).findIndex((p) => p.id === portId)
  if (inIdx >= 0) {
    const widths = widthsOf(parentDef, instance.id, inputPorts(ports))
    return { x: instance.pos.x - w / 2, y: instance.pos.y + sidePinOffset(widths, inIdx) }
  }
  const outIdx = outputPorts(ports).findIndex((p) => p.id === portId)
  const widths = widthsOf(parentDef, instance.id, outputPorts(ports))
  return { x: instance.pos.x + w / 2, y: instance.pos.y + sidePinOffset(widths, outIdx) }
}

export interface Bounds {
  x: number
  y: number
  w: number
  h: number
}

export function instanceBounds(parentDef: CompositeDef, instance: Instance, def: ChildDef, pad = 0): Bounds {
  const { w, h } = instanceBodySize(parentDef, instance, def)
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
  parentDef: CompositeDef,
): Instance | null {
  for (let i = instances.length - 1; i >= 0; i--) {
    const inst = instances[i]
    const b = instanceBounds(parentDef, inst, inst.def, 4)
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
 * When `prefer` is given, only pins of that role are considered (used to disambiguate
 * a join-point's coincident input/output terminals).
 */
export function hitTestPort(
  wx: number,
  wy: number,
  instances: Instance[],
  parentDef: CompositeDef,
  prefer?: 'source' | 'sink',
): PortHit | null {
  let best: PortHit | null = null
  let bestDist = Infinity
  const consider = (ref: PinRef, pos: { x: number; y: number }, role: 'source' | 'sink') => {
    if (prefer && prefer !== role) return
    // Distance to the terminal marker (a vertical segment of half-height r): anywhere
    // along the marker counts, not just its centre.
    const r = pinRadiusWorld(pinWidth(parentDef, ref))
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
    const def = inst.def
    const dir = portGroupDirection(def)
    if (dir === 'input') {
      for (const p of inputPorts(parentDef.ports)) {
        consider({ instanceId: inst.id, portId: p.id }, portPosition(parentDef, inst, def, p.id), 'source')
      }
    } else if (dir === 'output') {
      for (const p of outputPorts(parentDef.ports)) {
        consider({ instanceId: inst.id, portId: p.id }, portPosition(parentDef, inst, def, p.id), 'sink')
      }
    } else {
      const ports = childPorts(def)
      for (const p of outputPorts(ports)) {
        consider({ instanceId: inst.id, portId: p.id }, portPosition(parentDef, inst, def, p.id), 'source')
      }
      for (const p of inputPorts(ports)) {
        consider({ instanceId: inst.id, portId: p.id }, portPosition(parentDef, inst, def, p.id), 'sink')
      }
    }
  }

  return best
}

/** The number of lanes an array currently has (WIRE = port count, BUS = resolved width). */
export function arrayLaneCount(
  parentDef: CompositeDef,
  instance: Instance,
  def: ChildDef,
): number | null {
  const ports = childPorts(def)
  if (ports.length > 1) return ports.length
  return resolvedPinWidth(parentDef, { instanceId: instance.id, portId: ports[0].id })
}

/** World-space indicator circles (center y + radius) for a switch/led array, or null
 *  when its bus width is undetermined. The radius is zoom-aware so it matches the
 *  screen-space circle drawn by the renderer. */
export function arrayIndicatorLanes(
  parentDef: CompositeDef,
  instance: Instance,
  def: ChildDef,
  zoom: number,
): { y: number; r: number }[] | null {
  const n = arrayLaneCount(parentDef, instance, def)
  if (n === null) return null
  const h = instanceBodySize(parentDef, instance, def).h
  const r = Math.max(3 / zoom, (h / Math.max(n, 1)) * 0.3)
  const lanes: { y: number; r: number }[] = []
  const ports = childPorts(def)
  if (ports.length > 1) {
    for (let i = 0; i < n; i++) {
      lanes.push({ y: portPosition(parentDef, instance, def, ports[i].id).y, r })
    }
  } else {
    const port = ports[0]
    const y = portPosition(parentDef, instance, def, port.id).y
    const width = pinWidth(parentDef, { instanceId: instance.id, portId: port.id })
    for (const dy of busWireOffsets(width)) lanes.push({ y: y + dy, r })
  }
  return lanes
}

/** Lane index of the array indicator under a world point, or null when outside. */
export function hitArrayIndicator(
  wx: number,
  wy: number,
  parentDef: CompositeDef,
  instance: Instance,
  def: ChildDef,
  zoom: number,
): number | null {
  const lanes = arrayIndicatorLanes(parentDef, instance, def, zoom)
  if (!lanes) return null
  const dx = wx - instance.pos.x
  for (let i = 0; i < lanes.length; i++) {
    const dy = wy - lanes[i].y
    if (dx * dx + dy * dy <= lanes[i].r * lanes[i].r) return i
  }
  return null
}

/** World-space bounding box of everything inside a composite def, or null when empty. */
export function defContentsBounds(def: CompositeDef): Bounds | null {
  const insts = def.instances
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const inst of insts) {
    const b = instanceBounds(def, inst, inst.def)
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.w)
    maxY = Math.max(maxY, b.y + b.h)
  }
  if (!Number.isFinite(minX)) return null
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}
