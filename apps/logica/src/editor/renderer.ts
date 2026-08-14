import type { ComponentDef, Design, Instance } from '@logica/model'
import { defBodySize, instanceBounds, portPosition } from './geometry'
import { wirePath } from './routing'
import type { Palette } from './palette'
import type { Viewport } from '../state/editorStore'

const GRID = 24

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
  for (let i = 0; i < def.inputs; i++) {
    const port = portPosition(instance, def, `in:${i}`)
    const s = w2s(port.x, port.y, w, h, vp)
    ctx.beginPath()
    ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2)
    ctx.fillStyle = p.pin
    ctx.fill()
  }
  for (let i = 0; i < def.outputs; i++) {
    const port = portPosition(instance, def, `out:${i}`)
    const s = w2s(port.x, port.y, w, h, vp)
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

export function drawScene(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  design: Design,
  vp: Viewport,
  selectedId: string | null,
  defId: string,
  p: Palette,
) {
  ctx.fillStyle = p.bg
  ctx.fillRect(0, 0, cw, ch)
  drawGrid(ctx, cw, ch, vp, p)

  const def = design.defs[defId]
  if (!def) return

  const instances = def.instances ?? []
  const byId = new Map(instances.map((i) => [i.id, i]))

  for (const conn of def.connections ?? []) {
    const from = byId.get(conn.from.instanceId)
    const to = byId.get(conn.to.instanceId)
    if (!from || !to) continue
    const fromDef = design.defs[from.defId]
    const toDef = design.defs[to.defId]
    const a = portPosition(from, fromDef, conn.from.portId)
    const b = portPosition(to, toDef, conn.to.portId)
    const path = wirePath(a, b)
    const s = w2s(path.start.x, path.start.y, cw, ch, vp)
    const c1 = w2s(path.c1.x, path.c1.y, cw, ch, vp)
    const c2 = w2s(path.c2.x, path.c2.y, cw, ch, vp)
    const e = w2s(path.end.x, path.end.y, cw, ch, vp)
    ctx.beginPath()
    ctx.moveTo(s.x, s.y)
    ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, e.x, e.y)
    ctx.strokeStyle = p.wire
    ctx.lineWidth = 1.5
    ctx.stroke()
  }

  for (const inst of instances) {
    const instDef = design.defs[inst.defId]
    drawInstance(ctx, inst, instDef, cw, ch, vp, inst.id === selectedId, p)
  }
}
