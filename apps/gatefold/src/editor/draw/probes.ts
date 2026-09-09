import type { ChildDef, CompositeDef, Instance, Palette, Signal } from '@gatefold/model'
import { childPorts, childPrimitive, inputPorts, invertSignal, sevenSegDigits, sevenSegGeometry, sevenSegModeOf, sevenSegPositionCount, switchInitialLanes } from '@gatefold/model'
import {
  arrayIndicatorLanes,
  SEVEN_SEG_DIGIT_H,
  SEVEN_SEG_DIGIT_W,
  SEVEN_SEG_GAP,
  SEVEN_SEG_PAD,
  sevenSegLaneCount,
  switchValueBadge,
} from '../geometry'
import { w2s } from '../viewport'
import { drawRoundedBox, drawSwitchValueBadge, drawUndetermined, fillPolygon } from './shapes'
import type { SimView, Viewport } from '../types'

/**
 * Probe bodies: the 7-seg display and the switch/led arrays. These are the only
 * primitives whose rendering depends on multi-lane resolved geometry, so they are
 * kept together and apart from the generic instance/pin drawing.
 */

/** Draw a seven-seg body, one display slot per the primitive's mode, or "?" when undetermined. */
export function drawSevenSegBody(
  ctx: CanvasRenderingContext2D,
  parentDef: CompositeDef,
  instance: Instance,
  def: ChildDef,
  cx: number,
  cy: number,
  h: number,
  vp: Viewport,
  p: Palette,
  sim?: SimView,
) {
  const lanes = sevenSegLaneCount(parentDef, instance, def)
  const mode = sevenSegModeOf(instance.props)
  const positions = lanes === null ? 1 : sevenSegPositionCount(lanes, mode)
  const zoom = vp.zoom
  const digitW = SEVEN_SEG_DIGIT_W * zoom
  const digitH = SEVEN_SEG_DIGIT_H * zoom
  const gap = SEVEN_SEG_GAP * zoom
  const pad = SEVEN_SEG_PAD * zoom
  const totalW = pad * 2 + positions * digitW + (positions - 1) * gap

  drawRoundedBox(ctx, cx - totalW / 2, cy - h / 2, totalW, h, 6, p.sevenSegFill, p.sevenSegStroke)

  if (lanes === null) {
    drawUndetermined(ctx, cx, cy, h, p)
    return
  }

  const startX = cx - totalW / 2 + pad + digitW / 2

  const order = instance.props?.order === 'desc'
  let raw = sim ? sim.signalOf(instance.id, inputPorts(childPorts(def))[0].id) : undefined
  if (raw && inputPorts(childPorts(def))[0]?.inverted) raw = raw.map(invertSignal)
  const bits = raw ? (order ? [...raw].reverse() : raw) : []
  const masks = bits.length > 0 ? sevenSegDigits(bits, mode) : Array.from({ length: positions }, () => null)

  for (let d = 0; d < positions; d++) {
    const dx = startX + d * (digitW + gap)
    const segs = sevenSegGeometry({ x: dx, y: cy, w: digitW, h: digitH, palette: p })

    ctx.fillStyle = p.sevenSegOff
    for (const poly of segs) fillPolygon(ctx, poly)

    const pattern = masks[d]
    if (!pattern) continue
    ctx.fillStyle = p.sevenSegOn
    for (let i = 0; i < 7; i++) {
      if (!pattern[i]) continue
      fillPolygon(ctx, segs[i])
    }
  }
}

/** Draw an array body (row of LEDs or switches), or a "?" box when its bus width is undetermined. */
export function drawArrayBody(
  ctx: CanvasRenderingContext2D,
  parentDef: CompositeDef,
  instance: Instance,
  def: ChildDef,
  cx: number,
  cy: number,
  w: number,
  h: number,
  cw: number,
  ch: number,
  vp: Viewport,
  p: Palette,
  sim?: SimView,
) {
  const kind = childPrimitive(def)
  const isSwitch = kind === 'switch-array'

  drawRoundedBox(ctx, cx - w / 2, cy - h / 2, w, h, 6, p.gateFill, p.gateStroke)

  const lanes = arrayIndicatorLanes(parentDef, instance, def, vp.zoom)
  if (!lanes) {
    drawUndetermined(ctx, cx, cy, h, p)
    return
  }

  const initialLanes = isSwitch ? switchInitialLanes(instance.props, lanes.length) : null
  const ports = childPorts(def)
  for (let i = 0; i < lanes.length; i++) {
    const y = w2s(instance.pos.x, lanes[i].y, cw, ch, vp).y
    const r = lanes[i].r * vp.zoom
    let sig: Signal | undefined
    if (sim) {
      const port = ports.length > 1 ? ports[i] : ports[0]
      if (ports.length > 1) {
        const portId = port?.id
        if (portId) sig = sim.valueOf(instance.id, portId)
      } else {
        sig = port ? sim.signalOf(instance.id, port.id)?.[i] : undefined
      }
      if (sig !== undefined && port?.inverted) sig = invertSignal(sig)
    } else if (initialLanes) {
      sig = initialLanes[i]
    }
    drawArrayCell(ctx, cx, y, r, isSwitch, sig, p)
  }

  // The "#" value-entry badge sits in the body's top-left corner (simulate mode only).
  if (isSwitch && sim) {
    const badge = switchValueBadge(parentDef, instance, def, cw, ch, vp)
    if (badge) drawSwitchValueBadge(ctx, badge.x, badge.y, badge.s, p)
  }
}

/** Draw one array cell (a toggle switch or LED), lit when its signal is HI. */
function drawArrayCell(ctx: CanvasRenderingContext2D, cx: number, y: number, r: number, isSwitch: boolean, sig: Signal | undefined, p: Palette) {
  const on = sig === 1
  ctx.beginPath()
  ctx.arc(cx, y, r, 0, Math.PI * 2)
  ctx.fillStyle = on ? (isSwitch ? '#fbbf24' : '#ef4444') : p.gateFill
  ctx.fill()
  ctx.strokeStyle = p.gateStroke
  ctx.lineWidth = 1.5
  ctx.stroke()
}
