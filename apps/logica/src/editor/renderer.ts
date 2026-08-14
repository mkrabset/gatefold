import type { ComponentDef, Design, Instance, PinRef } from '@logica/model'
import { inputPorts, outputPorts } from '@logica/model'
import { defBodySize, instanceBounds, portPosition } from './geometry'
import { wirePath } from './routing'
import type { Palette } from './palette'
import type { Rect, Viewport } from '../state/editorStore'

const GRID = 24
const WIRE_WIDTH = 1.5
const HALO_WIDTH = 2.5
const TERMINAL_MARGIN = 48

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

interface Bounds {
  x: number
  y: number
  w: number
  h: number
}

function contentBounds(instances: Instance[], design: Design): Bounds {
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

function portTerminalPosition(def: ComponentDef, portId: string, bounds: Bounds): { x: number; y: number } {
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
    ctx.fillText(def.name, s.x, s.y)

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
    if (def.primitive && def.primitive !== 'clock' && def.primitive !== 'not') {
      ctx.fillStyle = p.text
      ctx.font = `${10 * vp.zoom}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(def.name, s.x, s.y - h * vp.zoom * 0.5 - 8 * vp.zoom)
    }
  }

  drawPorts(ctx, instance, def, cw, ch, vp, p)
}

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
    const key = pinKey(conn.from)
    const group = groups.get(key)
    if (group) group.push(trace)
    else groups.set(key, [trace])
  }

  for (const traces of groups.values()) {
    for (const t of traces) strokeWire(ctx, t.s, t.c1, t.c2, t.e, p.bg, WIRE_WIDTH + HALO_WIDTH * 2)
    for (const t of traces) strokeWire(ctx, t.s, t.c1, t.c2, t.e, p.wire, WIRE_WIDTH)
  }

  if (def.kind === 'composite') {
    drawPortTerminals(ctx, def, bounds, cw, ch, vp, p)
  }

  for (const inst of instances) {
    const instDef = design.defs[inst.defId]
    drawInstance(ctx, inst, instDef, cw, ch, vp, selectedIds.includes(inst.id), p)
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
