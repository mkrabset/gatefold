import type { ComponentDef, Design, Instance, PinRef, Port } from '@logica/model'
import { inputPorts, isPortGroupDef, outputPorts, portGroupDirection, primitiveOf } from '@logica/model'
import { isNeutralPin, pinWidth, undeterminedHint } from './widths'

export { isNeutralPin, pinWidth, undeterminedHint }

/**
 * Geometry helpers for the canvas: component sizes, port placement, and hit-testing.
 * All coordinates are in world space (pre-zoom); the renderer converts to screen space.
 *
 * Composite ports are represented by a single `input-port` / `output-port` instance
 * whose pins are *derived* from the enclosing composite's ports. Functions that need
 * those pins therefore take `parentDef` (the composite currently being edited). Body
 * heights are *dynamic*: they grow to fit the (bus-scaled) pin radii, so terminal
 * circles neither overlap nor stick out above/below the component.
 */

const PORT_GROUP_W = 56
const PORT_GROUP_SPACING = 24
const PORT_HIT_RADIUS = 6
/** Extra world-unit gap between adjacent pin circles. */
const PIN_GAP = 4

/** Pin marker half-height in world units (pre-zoom) for a terminal of the given width.
 *  Scales linearly so each bus lane keeps a constant pitch. */
export function pinRadiusWorld(width: number): number {
  return 3.5 * width
}

/** The y-position of the `index`-th of `total` pins, evenly distributed along `height` around `centerY`. */
export function distributedY(index: number, total: number, centerY: number, height: number): number {
  if (total <= 1) return centerY
  return centerY - height / 2 + ((index + 1) * height) / (total + 1)
}

/** World-space vertical offsets for each lane of a bus, inset one lane from each end
 *  of the marker (spread as if the bus were `width + 2` lanes wide). */
export function busWireOffsets(width: number): number[] {
  if (width <= 1) return [0]
  const r = pinRadiusWorld(width)
  const pitch = (2 * r) / (width + 1)
  return Array.from({ length: width }, (_, i) => -r + pitch * (i + 1))
}

/** Minimum height needed for `total` evenly-distributed pins of max radius to fit. */
export function neededHeight(total: number, maxRadius: number): number {
  if (total === 0) return 0
  if (total === 1) return 2 * maxRadius
  return (total + 1) * 2 * maxRadius + PIN_GAP
}

/** Size of a port-group rectangle given its pin count (base size). */
export function portGroupSize(n: number): { w: number; h: number } {
  return { w: PORT_GROUP_W, h: Math.max(28, n * PORT_GROUP_SPACING) }
}

/** The base body size of a def (before accounting for pin radii). */
export function defBodySize(def: ComponentDef): { w: number; h: number } {
  if (def.kind === 'primitive' && def.primitive) {
    return primitiveOf(def.primitive).bodySize()
  }
  return { w: 88, h: 56 }
}

function maxPinRadius(design: Design, parentDef: ComponentDef, instanceId: string, ports: Port[]): number {
  let max = 0
  for (const p of ports) {
    max = Math.max(max, pinRadiusWorld(pinWidth(design, parentDef, { instanceId, portId: p.id })))
  }
  return max
}

/** Effective size of a port-group rectangle, accounting for pin radii. */
export function sizeForPorts(n: number, maxRadius: number): { w: number; h: number } {
  const base = portGroupSize(n)
  return { w: base.w, h: Math.max(base.h, neededHeight(n, maxRadius)) }
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
    return sizeForPorts(ports.length, maxPinRadius(design, parentDef, instance.id, ports))
  }
  const base = defBodySize(def)
  const inR = maxPinRadius(design, parentDef, instance.id, inputPorts(def))
  const outR = maxPinRadius(design, parentDef, instance.id, outputPorts(def))
  const h = Math.max(base.h, neededHeight(inputPorts(def).length, inR), neededHeight(outputPorts(def).length, outR))
  return { w: base.w, h }
}

/**
 * World position of a port pin on an instance. For a normal instance, inputs are
 * distributed along the left edge and outputs along the right. For a port group, the
 * pins come from the parent composite's ports of the matching direction (inputs on
 * the right edge for `input-port`, on the left for `output-port`).
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
    const n = ports.length
    const { w, h } = sizeForPorts(n, maxPinRadius(design, parentDef, instance.id, ports))
    const y = distributedY(idx, n, instance.pos.y, h)
    return { x: instance.pos.x + (isInput ? w / 2 : -w / 2), y }
  }

  const { w, h } = instanceBodySize(design, parentDef, instance, def)
  const inIdx = inputPorts(def).findIndex((p) => p.id === portId)
  if (inIdx >= 0) {
    const total = inputPorts(def).length
    const y = distributedY(inIdx, total, instance.pos.y, h)
    return { x: instance.pos.x - w / 2, y }
  }
  const outIdx = outputPorts(def).findIndex((p) => p.id === portId)
  const total = outputPorts(def).length
  const y = distributedY(outIdx, total, instance.pos.y, h)
  return { x: instance.pos.x + w / 2, y }
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
    const d = Math.hypot(wx - pos.x, wy - pos.y)
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
