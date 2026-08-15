import type { ComponentDef, Design, Instance, PinRef } from '@logica/model'
import { inputPorts, outputPorts } from '@logica/model'
import { contentBounds, defBodySize, instanceBounds, portPosition, portTerminalPosition } from './geometry'
import type { Bounds } from './geometry'
import { wirePath } from './routing'
import type { Palette } from './palette'
import type { PendingWire, Rect, Viewport } from '../state/editorStore'
import type { HoverPort } from '../state/editorStore'

/**
 * Canvas renderer. `drawScene` is a pure-ish function of the current design,
 * viewport, selection, and palette — it reads no store state directly so it can be
 * redrawn deterministically. Draw order: background → grid → wires → port terminals
 * → instances → marquee.
 */

const GRID = 24
const WIRE_WIDTH = 1.5
const HALO_WIDTH = 2.5

/**
 * Stroke one cubic-bezier wire segment. Called twice per wire: once thick in the
 * background color (the "halo") and once thin in the wire color. Because wires are
 * drawn in source order, a later wire's halo cuts through an earlier wire, so
 * crossings read as pass-over rather than junctions.
 */
function strokeWire(
  ctx: CanvasRenderingContext2D,
  s: { x: number; y: number },
  c1: { x: number; y: number },
  c2: { x: number; y: number },
  e: { x: number; y: number },
  color: string,
  width: number,
) {
  ctx.beginPath()
  ctx.moveTo(s.x, s.y)
  ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, e.x, e.y)
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.stroke()
}

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, vp: Viewport, p: Palette) {
  ctx.fillStyle = p.grid
  const left = vp.x - w / 2 / vp.zoom
  const right = vp.x + w / 2 / vp.zoom
  const top = vp.y - h / 2 / vp.zoom
  const bottom = vp.y + h / 2 / vp.zoom
  const step = GRID
  const startX = Math.floor(left / step) * step
  const startY = Math.floor(top / step) * step
  for (let gx = startX; gx <= right; gx += step) {
    for (let gy = startY; gy <= bottom; gy += step) {
      const sx = w / 2 + (gx - vp.x) * vp.zoom
      const sy = h / 2 + (gy - vp.y) * vp.zoom
      ctx.fillRect(sx, sy, 1.5, 1.5)
    }
  }
}

function w2s(wx: number, wy: number, w: number, h: number, vp: Viewport) {
  return {
    x: w / 2 + (wx - vp.x) * vp.zoom,
    y: h / 2 + (wy - vp.y) * vp.zoom,
  }
}

function drawGateBody(
  ctx: CanvasRenderingContext2D,
  kind: string,
  cx: number,
  cy: number,
  w: number,
  h: number,
  p: Palette,
) {
  const l = cx - w / 2
  const r = cx + w / 2
  const t = cy - h / 2
  const b = cy + h / 2

  ctx.beginPath()
  switch (kind) {
    case 'and':
      ctx.moveTo(l, t)
      ctx.lineTo(l, b)
      ctx.ellipse(l, cy, w, h / 2, 0, Math.PI / 2, -Math.PI / 2, true)
      ctx.closePath()
      break
    case 'or':
      ctx.moveTo(l, t)
      ctx.quadraticCurveTo(l + w * 0.32, cy, l, b)
      ctx.quadraticCurveTo(cx + w * 0.15, b, r, cy)
      ctx.quadraticCurveTo(cx + w * 0.15, t, l, t)
      ctx.closePath()
      break
    case 'xor':
      ctx.moveTo(l, t)
      ctx.quadraticCurveTo(l + w * 0.32, cy, l, b)
      ctx.quadraticCurveTo(cx + w * 0.15, b, r, cy)
      ctx.quadraticCurveTo(cx + w * 0.15, t, l, t)
      ctx.closePath()
      ctx.moveTo(l - 7, t)
      ctx.quadraticCurveTo(l + w * 0.16, cy, l - 7, b)
      break
    case 'not':
      ctx.moveTo(l, t)
      ctx.lineTo(r - 7, cy)
      ctx.lineTo(l, b)
      ctx.closePath()
      break
    case 'clock':
      ctx.roundRect(l, t, w, h, 6)
      break
    default:
      ctx.roundRect(l, t, w, h, 6)
      break
  }
  ctx.fillStyle = p.gateFill
  ctx.fill()
  ctx.strokeStyle = p.gateStroke
  ctx.lineWidth = 1.5
  ctx.stroke()

  if (kind === 'not') {
    ctx.beginPath()
    ctx.arc(r - 3, cy, 4, 0, Math.PI * 2)
    ctx.fillStyle = p.gateFill
    ctx.fill()
    ctx.stroke()
  }

  if (kind === 'clock') {
    ctx.beginPath()
    ctx.strokeStyle = p.pin
    ctx.lineWidth = 1.5
    for (let x = l + 8; x <= r - 8; x += 1) {
      const y = cy + Math.sin(((x - (l + 8)) / (r - l - 16)) * Math.PI * 2) * 8
      if (x === l + 8) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
}

function drawPorts(
  ctx: CanvasRenderingContext2D,
  instance: Instance,
  def: ComponentDef,
  w: number,
  h: number,
  vp: Viewport,
  p: Palette,
) {
  for (const port of inputPorts(def)) {
    const pos = portPosition(instance, def, port.id)
    const s = w2s(pos.x, pos.y, w, h, vp)
    ctx.beginPath()
    ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2)
    ctx.fillStyle = p.pin
    ctx.fill()
  }
  for (const port of outputPorts(def)) {
    const pos = portPosition(instance, def, port.id)
    const s = w2s(pos.x, pos.y, w, h, vp)
    ctx.beginPath()
    ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2)
    ctx.fillStyle = p.pinHover
    ctx.fill()
  }
}

function drawInstance(
  ctx: CanvasRenderingContext2D,
  instance: Instance,
  def: ComponentDef,
  cw: number,
  ch: number,
  vp: Viewport,
  selected: boolean,
  p: Palette,
) {
  const { w, h } = defBodySize(def)
  const s = w2s(instance.pos.x, instance.pos.y, cw, ch, vp)

  if (selected) {
    const b = instanceBounds(instance, def, 6)
    const tl = w2s(b.x, b.y, cw, ch, vp)
    ctx.strokeStyle = p.selection
    ctx.setLineDash([4, 3])
    ctx.strokeRect(tl.x, tl.y, b.w * vp.zoom, b.h * vp.zoom)
    ctx.setLineDash([])
  }

  if (def.kind === 'composite') {
    const l = s.x - (w / 2) * vp.zoom
    const t = s.y - (h / 2) * vp.zoom
    ctx.beginPath()
    ctx.roundRect(l, t, w * vp.zoom, h * vp.zoom, 6 * vp.zoom)
    ctx.fillStyle = p.compositeFill
    ctx.fill()
    ctx.strokeStyle = p.gateStroke
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.fillStyle = p.text
    ctx.font = `${12 * vp.zoom}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    // The instance name is the unique identifier; the type is shown above the box.
    ctx.fillText(instance.name, s.x, s.y)
    ctx.font = `${9 * vp.zoom}px system-ui, sans-serif`
    ctx.fillText(def.name, s.x, s.y - (h / 2) * vp.zoom - 8 * vp.zoom)

    ctx.font = `${9 * vp.zoom}px system-ui, sans-serif`
    ctx.fillStyle = p.text
    for (const port of inputPorts(def)) {
      const pos = portPosition(instance, def, port.id)
      const ps = w2s(pos.x, pos.y, cw, ch, vp)
      ctx.textAlign = 'right'
      ctx.fillText(port.name, ps.x - 6 * vp.zoom, ps.y)
    }
    for (const port of outputPorts(def)) {
      const pos = portPosition(instance, def, port.id)
      const ps = w2s(pos.x, pos.y, cw, ch, vp)
      ctx.textAlign = 'left'
      ctx.fillText(port.name, ps.x + 6 * vp.zoom, ps.y)
    }
  } else {
    drawGateBody(ctx, def.primitive ?? '', s.x, s.y, w * vp.zoom, h * vp.zoom, p)
    // Type label above the gate (NOT/CLOCK symbols are self-explanatory).
    if (def.primitive && def.primitive !== 'clock' && def.primitive !== 'not') {
      ctx.fillStyle = p.text
      ctx.font = `${10 * vp.zoom}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(def.name, s.x, s.y - h * vp.zoom * 0.5 - 8 * vp.zoom)
    }
    // Instance name below the gate.
    ctx.fillStyle = p.text
    ctx.font = `${10 * vp.zoom}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(instance.name, s.x, s.y + h * vp.zoom * 0.5 + 8 * vp.zoom)
  }

  drawPorts(ctx, instance, def, cw, ch, vp, p)
}

/** Render a composite's own ports as terminals, labeled, beside the content bounds. */
function drawPortTerminals(
  ctx: CanvasRenderingContext2D,
  def: ComponentDef,
  bounds: Bounds,
  cw: number,
  ch: number,
  vp: Viewport,
  p: Palette,
) {
  ctx.font = `${11 * vp.zoom}px system-ui, sans-serif`
  ctx.textBaseline = 'middle'
  for (const port of def.ports) {
    const pos = portTerminalPosition(def, port.id, bounds)
    const s = w2s(pos.x, pos.y, cw, ch, vp)
    ctx.beginPath()
    ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2)
    ctx.fillStyle = port.direction === 'input' ? p.pin : p.pinHover
    ctx.fill()
    ctx.fillStyle = p.text
    if (port.direction === 'input') {
      ctx.textAlign = 'right'
      ctx.fillText(port.name, s.x - 8 * vp.zoom, s.y)
    } else {
      ctx.textAlign = 'left'
      ctx.fillText(port.name, s.x + 8 * vp.zoom, s.y)
    }
  }
}

function pinKey(ref: PinRef): string {
  return ref.kind === 'instance' ? `${ref.instanceId}:${ref.portId}` : `port:${ref.portId}`
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  design: Design,
  vp: Viewport,
  selectedIds: string[],
  defId: string,
  marquee: Rect | null,
  pendingWire: PendingWire | null,
  hoverPort: HoverPort | null,
  p: Palette,
) {
  ctx.fillStyle = p.bg
  ctx.fillRect(0, 0, cw, ch)
  drawGrid(ctx, cw, ch, vp, p)

  const def = design.defs[defId]
  if (!def) return

  const instances = def.instances ?? []
  const byId = new Map(instances.map((i) => [i.id, i]))
  const bounds = contentBounds(instances, design)

  const resolveEndpoint = (ref: PinRef): { x: number; y: number } | null => {
    if (ref.kind === 'instance') {
      const inst = byId.get(ref.instanceId)
      if (!inst) return null
      return portPosition(inst, design.defs[inst.defId], ref.portId)
    }
    return portTerminalPosition(def, ref.portId, bounds)
  }

  interface Trace {
    s: { x: number; y: number }
    c1: { x: number; y: number }
    c2: { x: number; y: number }
    e: { x: number; y: number }
  }

  const groups = new Map<string, Trace[]>()
  for (const conn of def.connections ?? []) {
    // Hide a connection that is being re-targeted (its preview replaces it).
    if (pendingWire && conn.id === pendingWire.originalId) continue
    const a = resolveEndpoint(conn.from)
    const b = resolveEndpoint(conn.to)
    if (!a || !b) continue
    const path = wirePath(a, b)
    const trace: Trace = {
      s: w2s(path.start.x, path.start.y, cw, ch, vp),
      c1: w2s(path.c1.x, path.c1.y, cw, ch, vp),
      c2: w2s(path.c2.x, path.c2.y, cw, ch, vp),
      e: w2s(path.end.x, path.end.y, cw, ch, vp),
    }
    // Group by source so fan-out wires render as one bundle (all halos, then all
    // lines) rather than cutting into each other at their shared terminal.
    const key = pinKey(conn.from)
    const group = groups.get(key)
    if (group) group.push(trace)
    else groups.set(key, [trace])
  }

  for (const traces of groups.values()) {
    for (const t of traces) strokeWire(ctx, t.s, t.c1, t.c2, t.e, p.bg, WIRE_WIDTH + HALO_WIDTH * 2)
    for (const t of traces) strokeWire(ctx, t.s, t.c1, t.c2, t.e, p.wire, WIRE_WIDTH)
  }

  // Preview of a wire currently being drawn (dashed, accent color).
  if (pendingWire) {
    const a = resolveEndpoint(pendingWire.from)
    if (a) {
      const path = wirePath(a, { x: pendingWire.x, y: pendingWire.y })
      const s = w2s(path.start.x, path.start.y, cw, ch, vp)
      const c1 = w2s(path.c1.x, path.c1.y, cw, ch, vp)
      const c2 = w2s(path.c2.x, path.c2.y, cw, ch, vp)
      const e = w2s(path.end.x, path.end.y, cw, ch, vp)
      ctx.beginPath()
      ctx.moveTo(s.x, s.y)
      ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, e.x, e.y)
      ctx.strokeStyle = p.selection
      ctx.lineWidth = WIRE_WIDTH
      ctx.setLineDash([5, 4])
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  if (def.kind === 'composite') {
    drawPortTerminals(ctx, def, bounds, cw, ch, vp, p)
  }

  for (const inst of instances) {
    const instDef = design.defs[inst.defId]
    drawInstance(ctx, inst, instDef, cw, ch, vp, selectedIds.includes(inst.id), p)
  }

  // Highlight the hovered port: yellow = create a wire, orange = grab an existing one.
  if (hoverPort) {
    const pos = resolveEndpoint(hoverPort.ref)
    if (pos) {
      const s = w2s(pos.x, pos.y, cw, ch, vp)
      ctx.beginPath()
      ctx.arc(s.x, s.y, 6, 0, Math.PI * 2)
      ctx.strokeStyle = hoverPort.action === 'grab' ? p.grabHover : p.portHover
      ctx.lineWidth = 2
      ctx.stroke()
    }
  }

  if (marquee) {
    const tl = w2s(Math.min(marquee.x0, marquee.x1), Math.min(marquee.y0, marquee.y1), cw, ch, vp)
    const br = w2s(Math.max(marquee.x0, marquee.x1), Math.max(marquee.y0, marquee.y1), cw, ch, vp)
    ctx.fillStyle = 'rgba(79, 140, 255, 0.08)'
    ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y)
    ctx.strokeStyle = p.selection
    ctx.lineWidth = 1
    ctx.setLineDash([4, 3])
    ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y)
    ctx.setLineDash([])
  }
}
