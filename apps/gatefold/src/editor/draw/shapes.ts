import type { Palette } from '@gatefold/model'
import type { Viewport } from '../types'

/** Grid spacing in world units. */
export const GRID = 24
/** Wire stroke width in screen pixels (zoom-independent). */
export const WIRE_WIDTH = 1.5
/** Extra halo width on each side of a wire, in screen pixels (zoom-independent). */
export const HALO_MARGIN = 3

export function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, vp: Viewport, p: Palette) {
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

/**
 * Stroke one cubic-bezier wire segment. Called twice per wire: once thick in the
 * background color (the "halo") and once thin in the wire color. Because wires are
 * drawn in source order, a later wire's halo cuts through an earlier wire, so
 * crossings read as pass-over rather than junctions.
 */
export function strokeWire(
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

/** Draw a filled rounded rectangle with a stroke. */
export function drawRoundedBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
  stroke: string,
  lineWidth = 1.5,
) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.strokeStyle = stroke
  ctx.lineWidth = lineWidth
  ctx.stroke()
}

/** Draw the undetermined-width "?" placeholder centered at (cx, cy). */
export function drawUndetermined(ctx: CanvasRenderingContext2D, cx: number, cy: number, h: number, p: Palette) {
  ctx.fillStyle = p.text
  ctx.font = `${Math.max(16, h * 0.4)}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('?', cx, cy)
}

/** Draw a switch-array's "#" value-entry badge at (x, y), `s` px square. */
export function drawSwitchValueBadge(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, p: Palette) {
  drawRoundedBox(ctx, x, y, s, s, 3, p.gateFill, p.gateStroke, 1.5)
  ctx.fillStyle = p.text
  ctx.font = `${Math.round(s * 0.72)}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('#', x + s / 2, y + s / 2 + 0.5)
}

/** Draw a switch-array's "exported" badge (a module-input marker) at (x, y), `s` px square. */
export function drawExportBadge(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, p: Palette) {
  drawRoundedBox(ctx, x, y, s, s, 3, p.gateFill, p.pin, 1.5)
  ctx.fillStyle = p.pin
  ctx.font = `${Math.round(s * 0.7)}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('▸', x + s / 2, y + s / 2 + 0.5)
}

/** Stroke a dashed rectangle (selection / marquee outline). */
export function strokeDashedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
) {
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.setLineDash([4, 3])
  ctx.strokeRect(x, y, w, h)
  ctx.setLineDash([])
}

/** Fill a polygon given as a list of [x, y] points. */
export function fillPolygon(ctx: CanvasRenderingContext2D, poly: [number, number][]): void {
  ctx.beginPath()
  ctx.moveTo(poly[0][0], poly[0][1])
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1])
  ctx.closePath()
  ctx.fill()
}

/** Draw a small tooltip label (e.g. the bus arity) near a screen point. */
export function drawTooltip(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, p: Palette) {
  ctx.font = '11px system-ui, sans-serif'
  const textWidth = ctx.measureText(text).width
  const padX = 6
  const boxW = textWidth + padX * 2
  const boxH = 16
  const bx = x
  const by = y - boxH - 10
  ctx.beginPath()
  ctx.roundRect(bx, by, boxW, boxH, 4)
  ctx.fillStyle = p.compositeFill
  ctx.fill()
  ctx.strokeStyle = p.gateStroke
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.fillStyle = p.text
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, bx + padX, by + boxH / 2 + 1)
}
