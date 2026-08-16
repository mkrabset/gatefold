import type { ComponentDef, Design, Instance, PinRef } from '@logica/model'
import { inputPorts, isPortGroupDef, outputPorts, pinRefEquals, portGroupDirection, primitiveOf } from '@logica/model'

/**
 * Geometry helpers for the canvas: component sizes, port placement, and hit-testing.
 * All coordinates are in world space (pre-zoom); the renderer converts to screen space.
 *
 * Composite ports are represented by a single `input-port` / `output-port` instance
 * whose pins are *derived* from the enclosing composite's ports. Functions that need
 * those pins therefore take `parentDef` (the composite currently being edited).
 */

const PORT_GROUP_W = 56
const PORT_GROUP_SPACING = 24
const PORT_HIT_RADIUS = 6

/** Size of a port-group rectangle given its pin count. */
export function portGroupSize(n: number): { w: number; h: number } {
  return { w: PORT_GROUP_W, h: Math.max(28, n * PORT_GROUP_SPACING) }
}

export function defBodySize(def: ComponentDef): { w: number; h: number } {
  if (def.kind === 'primitive' && def.primitive) {
    return primitiveOf(def.primitive).bodySize()
  }
  return { w: 88, h: 56 }
}

/**
 * World position of a port pin on an instance. For a normal instance, inputs are
 * distributed along the left edge and outputs along the right. For a port group, the
 * pins come from the parent composite's ports of the matching direction (inputs on
 * the right edge for `input-port`, on the left for `output-port`).
 */
export function portPosition(
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
    const { w, h } = portGroupSize(n)
    const y = n <= 1 ? instance.pos.y : instance.pos.y - h / 2 + ((idx + 1) * h) / (n + 1)
    return { x: instance.pos.x + (isInput ? w / 2 : -w / 2), y }
  }

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

export function instanceBounds(parentDef: ComponentDef, instance: Instance, def: ComponentDef, pad = 0): Bounds {
  const { w, h } = isPortGroupDef(def)
    ? portGroupSize((portGroupDirection(def) === 'input' ? inputPorts(parentDef) : outputPorts(parentDef)).length)
    : defBodySize(def)
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
    const b = instanceBounds(parentDef, inst, def, 4)
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
    const dir = portGroupDirection(def)
    if (dir === 'input') {
      for (const p of inputPorts(parentDef)) {
        consider({ instanceId: inst.id, portId: p.id }, portPosition(parentDef, inst, def, p.id), 'source')
      }
    } else if (dir === 'output') {
      for (const p of outputPorts(parentDef)) {
        consider({ instanceId: inst.id, portId: p.id }, portPosition(parentDef, inst, def, p.id), 'sink')
      }
    } else {
      for (const p of outputPorts(def)) {
        consider({ instanceId: inst.id, portId: p.id }, portPosition(parentDef, inst, def, p.id), 'source')
      }
      for (const p of inputPorts(def)) {
        consider({ instanceId: inst.id, portId: p.id }, portPosition(parentDef, inst, def, p.id), 'sink')
      }
    }
  }

  return best
}

/**
 * The width (number of wires) of the pin referenced by `ref`, resolved within `parentDef`.
 * fan-in/fan-out have an intrinsic width from their arity; composite ports (a
 * composite's own terminal or a composite instance's pin) inherit their width from
 * whatever they are connected to; single wires are width 1. A composite port that is
 * not connected anywhere is neutral (1).
 *
 * For a composite *instance* pin (seen from the parent), the port's width is set by
 * what its internal `terminal` connects to inside the composite, so that is resolved
 * first; only when the inside is neutral does the pin fall back to the external wire.
 */
export function pinWidth(design: Design, parentDef: ComponentDef, ref: PinRef, visited?: Set<string>): number {
  const inst = parentDef.instances?.find((i) => i.id === ref.instanceId)
  if (!inst) return 1
  const def = design.defs[inst.defId]
  // A primitive's intrinsic width (fan-in output / fan-out input = arity).
  if (def.kind === 'primitive' && def.primitive) {
    const port = def.ports.find((p) => p.id === ref.portId)
    if (port) {
      const width = primitiveOf(def.primitive).intrinsicWidth(def.ports, port)
      if (width !== 1) return width
    }
  }
  // Composite port (its own terminal) or a composite instance's pin: follow the
  // connection in `parentDef` to inherit the width.
  if (isPortGroupDef(def) || def.kind === 'composite') {
    const seen = visited ?? new Set<string>()
    const key = `${parentDef.id}:${ref.instanceId}:${ref.portId}`
    if (seen.has(key)) return 1
    seen.add(key)
    // A composite instance's pin: its canonical width is what its internal terminal
    // is wired to inside the composite, so resolve that before the external wire.
    if (def.kind === 'composite') {
      const port = def.ports.find((p) => p.id === ref.portId)
      if (port?.terminal) {
        const internal = pinWidth(design, def, { instanceId: port.terminal.instanceId, portId: port.terminal.pinId }, seen)
        if (internal > 1) return internal
      }
    }
    for (const c of parentDef.connections ?? []) {
      if (pinRefEquals(c.from, ref)) return pinWidth(design, parentDef, c.to, seen)
      if (pinRefEquals(c.to, ref)) return pinWidth(design, parentDef, c.from, seen)
    }
    return 1
  }
  return 1
}

/**
 * True when `ref` is a composite/port-group pin whose width is undetermined (so it
 * adopts the width of whatever is connected to it). A composite instance pin is only
 * neutral when it has no external connection *and* its internal terminal is neutral.
 */
export function isNeutralPin(design: Design, parentDef: ComponentDef, ref: PinRef): boolean {
  const inst = parentDef.instances?.find((i) => i.id === ref.instanceId)
  if (!inst) return false
  const def = design.defs[inst.defId]
  const connected = (parentDef.connections ?? []).some((c) => pinRefEquals(c.from, ref) || pinRefEquals(c.to, ref))
  if (isPortGroupDef(def)) {
    return !connected
  }
  if (def.kind === 'composite') {
    if (connected) return false
    const port = def.ports.find((p) => p.id === ref.portId)
    if (port?.terminal) {
      return isNeutralPin(design, def, { instanceId: port.terminal.instanceId, portId: port.terminal.pinId })
    }
    return true
  }
  return false
}
