import type { ChildDef, CompositeDef, Instance, Palette, PinRef, Port } from '@gatefold/model'
import { childPorts, childPrimitive, inputPorts, outputPorts, periodOf, pinWidth, portGroupDirection, primitiveOf } from '@gatefold/model'
import {
  busWireOffsets,
  instanceBodySize,
  instanceBounds,
  pinRadiusWorld,
  portPosition,
  sidePinOffset,
  sizeForPorts,
} from '../geometry'
import { w2s } from '../viewport'
import { canvasVectorContext } from '../canvasVector'
import { formatFrequency } from '../../util/format'
import { HALO_MARGIN, drawRoundedBox, strokeDashedRect } from './shapes'
import { drawArrayBody, drawSevenSegBody } from './probes'
import type { SimView, Viewport } from '../types'

/**
 * Instance and terminal drawing: the pins (with inversion bubbles), the port-group
 * rectangles, and the per-instance body rendering (primitive glyph, composite box,
 * or probe body). These read only the world-space geometry from `geometry.ts` and
 * convert to screen space here.
 */

/** Pin radius, scaled up for bus terminals (proportional to width) and the zoom. */
function pinRadius(width: number, zoom: number): number {
  return pinRadiusWorld(width) * zoom
}

/** Draw the hollow inversion bubble (a ring 50% larger than the pin). */
function drawInversionRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  zoom: number,
  p: Palette,
  bg: string,
) {
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fillStyle = bg
  ctx.fill()
  ctx.strokeStyle = p.gateStroke
  ctx.lineWidth = 0.5 * zoom
  ctx.stroke()
}

/** Gap between a terminal and its name label, in world units. */
const PIN_LABEL_GAP = 10

/** Screen-space offset for a terminal label (clears the pin stroke and any bubble). */
function pinLabelOffset(inverted: boolean, zoom: number): number {
  const bubble = inverted ? 2 * pinRadiusWorld(1) : 0
  return (bubble + PIN_LABEL_GAP) * zoom
}

/**
 * Draw a single terminal pin: a vertical stroke centred on the edge position, plus —
 * when the port is inverted — an inversion bubble shifted just outside the edge so it
 * touches the component at the port position.
 */
function drawPin(
  ctx: CanvasRenderingContext2D,
  s: { x: number; y: number },
  width: number,
  color: string,
  inverted: boolean,
  bubbleOnLeft: boolean,
  vp: Viewport,
  p: Palette,
  bg: string,
  hovered: boolean,
  signalColor?: string,
) {
  const radius = pinRadius(width, vp.zoom)
  ctx.strokeStyle = signalColor ?? (hovered ? p.pinHighlight : color)
  ctx.lineWidth = 4 * vp.zoom
  ctx.beginPath()
  ctx.moveTo(s.x, s.y - radius)
  ctx.lineTo(s.x, s.y + radius)
  ctx.stroke()
  if (inverted) {
    // One bubble per wire lane, so a wide bus doesn't get a single huge bubble.
    const laneRadius = pinRadiusWorld(1) * vp.zoom * 1.2
    const dir = bubbleOnLeft ? -1 : 1
    for (const dy of busWireOffsets(width)) {
      drawInversionRing(ctx, s.x + dir * laneRadius, s.y + dy * vp.zoom, laneRadius, vp.zoom, p, bg)
    }
  }
}

function drawPorts(
  ctx: CanvasRenderingContext2D,
  parentDef: CompositeDef,
  instance: Instance,
  def: ChildDef,
  cw: number,
  ch: number,
  vp: Viewport,
  p: Palette,
  bg: string,
  hoverPort: PinRef | null,
  sim?: SimView,
) {
  const ports = childPorts(def)
  const drawPort = (port: Port, color: string, bubbleOnLeft: boolean) => {
    const pos = portPosition(parentDef, instance, def, port.id)
    const s = w2s(pos.x, pos.y, cw, ch, vp)
    const width = pinWidth(parentDef, { instanceId: instance.id, portId: port.id })
    const hovered = !!hoverPort && hoverPort.instanceId === instance.id && hoverPort.portId === port.id
    const signalColor = sim?.colorOf(instance.id, port.id)
    drawPin(ctx, s, width, color, port.inverted ?? false, bubbleOnLeft, vp, p, bg, hovered, signalColor)
  }

  for (const port of inputPorts(ports)) drawPort(port, p.pin, true)
  for (const port of outputPorts(ports)) drawPort(port, p.pinHover, false)
}

/**
 * Draw a primitive's terminal names inside its body, next to each pin. Used by primitives
 * whose terminals have distinct purposes (e.g. the DFF's D/CLK/RST), so the pins are
 * self-explanatory without hovering.
 */
function drawTerminalLabels(
  ctx: CanvasRenderingContext2D,
  parentDef: CompositeDef,
  instance: Instance,
  def: ChildDef,
  cw: number,
  ch: number,
  vp: Viewport,
  p: Palette,
) {
  ctx.fillStyle = p.text
  ctx.font = `${9 * vp.zoom}px system-ui, sans-serif`
  ctx.textBaseline = 'middle'
  const gap = 8 * vp.zoom
  for (const port of inputPorts(childPorts(def))) {
    const pos = portPosition(parentDef, instance, def, port.id)
    const ps = w2s(pos.x, pos.y, cw, ch, vp)
    ctx.textAlign = 'left'
    ctx.fillText(port.name, ps.x + gap, ps.y)
  }
  for (const port of outputPorts(childPorts(def))) {
    const pos = portPosition(parentDef, instance, def, port.id)
    const ps = w2s(pos.x, pos.y, cw, ch, vp)
    ctx.textAlign = 'right'
    ctx.fillText(port.name, ps.x - gap, ps.y)
  }
}

/** Draw a join-point (NODE) dot: wire-colored, signal-colored in sim, red on hover. */
function drawJoinpoint(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  vp: Viewport,
  p: Palette,
  hovered: boolean,
  sim: SimView | undefined,
  instanceId: string,
  portId: string,
) {
  const r = 4 * vp.zoom
  const color = sim ? (sim.colorOf(instanceId, portId) ?? p.wire) : hovered ? p.pinHighlight : p.wire
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
}

/** Halo behind a join-point dot: a background ring separating it from crossing wires. */
function drawJoinpointHalo(ctx: CanvasRenderingContext2D, cx: number, cy: number, vp: Viewport, bg: string) {
  ctx.beginPath()
  ctx.arc(cx, cy, 4 * vp.zoom + HALO_MARGIN, 0, Math.PI * 2)
  ctx.fillStyle = bg
  ctx.fill()
}

/** Draw a join-point (NODE): its selection outline and its dot. */
function drawJoinpointNode(
  ctx: CanvasRenderingContext2D,
  parentDef: CompositeDef,
  instance: Instance,
  cw: number,
  ch: number,
  vp: Viewport,
  selected: boolean,
  p: Palette,
  hovered: boolean,
  sim: SimView | undefined,
) {
  const def = instance.def
  const s = w2s(instance.pos.x, instance.pos.y, cw, ch, vp)
  if (selected) {
    const b = instanceBounds(parentDef, instance, def, 6)
    const tl = w2s(b.x, b.y, cw, ch, vp)
    strokeDashedRect(ctx, tl.x, tl.y, b.w * vp.zoom, b.h * vp.zoom, p.selection)
  }
  drawJoinpoint(ctx, s.x, s.y, vp, p, hovered, sim, instance.id, outputPorts(childPorts(def))[0].id)
}

function drawInstance(
  ctx: CanvasRenderingContext2D,
  parentDef: CompositeDef,
  instance: Instance,
  def: ChildDef,
  cw: number,
  ch: number,
  vp: Viewport,
  selected: boolean,
  p: Palette,
  bg: string,
  hoverPort: PinRef | null,
  sim?: SimView,
) {
  const { w, h } = instanceBodySize(parentDef, instance, def)
  const s = w2s(instance.pos.x, instance.pos.y, cw, ch, vp)
  const kind = childPrimitive(def)

  if (selected) {
    const b = instanceBounds(parentDef, instance, def, 6)
    const tl = w2s(b.x, b.y, cw, ch, vp)
    strokeDashedRect(ctx, tl.x, tl.y, b.w * vp.zoom, b.h * vp.zoom, p.selection)
  }

  if (kind === null) {
    // Composite instance: a box with port names beside the pins.
    const l = s.x - (w / 2) * vp.zoom
    const t = s.y - (h / 2) * vp.zoom
    drawRoundedBox(ctx, l, t, w * vp.zoom, h * vp.zoom, 6 * vp.zoom, p.compositeFill, p.gateStroke)
    ctx.fillStyle = p.text
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `${11 * vp.zoom}px system-ui, sans-serif`
    ctx.fillText(def.kind === 'composite' ? def.name : '', s.x, s.y)
    ctx.font = `${10 * vp.zoom}px system-ui, sans-serif`
    ctx.fillText(instance.name, s.x, s.y + h * vp.zoom * 0.5 + 8 * vp.zoom)

    ctx.font = `${9 * vp.zoom}px system-ui, sans-serif`
    ctx.fillStyle = p.text

    const drawPortLabel = (port: Port, align: CanvasTextAlign) => {
      const pos = portPosition(parentDef, instance, def, port.id)
      const ps = w2s(pos.x, pos.y, cw, ch, vp)
      const offset = pinLabelOffset(port.inverted ?? false, vp.zoom)
      ctx.textAlign = align
      const x = align === 'right' ? ps.x - offset : ps.x + offset
      ctx.fillText(port.name, x, ps.y)
    }

    for (const port of inputPorts(childPorts(def))) {
      drawPortLabel(port, 'right')
    }
    for (const port of outputPorts(childPorts(def))) {
      drawPortLabel(port, 'left')
    }
  } else {
    const prim = primitiveOf(kind)
    const pinRadiusOf = (portId: string) =>
      pinRadiusWorld(pinWidth(parentDef, { instanceId: instance.id, portId })) * vp.zoom
    if (kind === 'switch-array' || kind === 'led-array') {
      drawArrayBody(ctx, parentDef, instance, def, s.x, s.y, w * vp.zoom, h * vp.zoom, cw, ch, vp, p, sim)
    } else if (kind === 'seven-seg') {
      drawSevenSegBody(ctx, parentDef, instance, def, s.x, s.y, h * vp.zoom, vp, p, sim)
    } else {
      prim.draw(canvasVectorContext(ctx), {
        x: s.x,
        y: s.y,
        w: w * vp.zoom,
        h: h * vp.zoom,
        palette: p,
        pinRadius: pinRadiusOf,
      })
    }
    // Terminal names inside the body for primitives with distinct terminals (DFF).
    if (prim.showTerminalNames?.()) {
      drawTerminalLabels(ctx, parentDef, instance, def, cw, ch, vp, p)
    }
    // Type label: AND/OR/XOR write it inside the body, the arrays keep it above,
    // every other primitive omits it.
    if (kind === 'and' || kind === 'or' || kind === 'xor') {
      ctx.fillStyle = p.text
      ctx.font = `${11 * vp.zoom}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(prim.label, s.x, s.y)
    } else if (kind === 'switch-array' || kind === 'led-array') {
      ctx.fillStyle = p.text
      ctx.font = `${10 * vp.zoom}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(prim.label, s.x, s.y - h * vp.zoom * 0.5 - 8 * vp.zoom)
    }
    // Clock frequency above the body (the CLOCK type label is skipped).
    if (kind === 'clock') {
      const period = periodOf(instance.props)
      ctx.fillStyle = p.text
      ctx.font = `${10 * vp.zoom}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(formatFrequency(1e12 / period), s.x, s.y - h * vp.zoom * 0.5 - 8 * vp.zoom)
    }
    // Instance name below the gate.
    ctx.fillStyle = p.text
    ctx.font = `${10 * vp.zoom}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(instance.name, s.x, s.y + h * vp.zoom * 0.5 + 8 * vp.zoom)
  }

  drawPorts(ctx, parentDef, instance, def, cw, ch, vp, p, bg, hoverPort, sim)
}

/**
 * A port group: a single rectangle carrying all of a composite's inputs (or outputs).
 * `input-port` draws green source pins on its right edge; `output-port` draws sink
 * pins on its left edge. Movable as one unit.
 */
function drawPortGroup(
  ctx: CanvasRenderingContext2D,
  parentDef: CompositeDef,
  instance: Instance,
  def: ChildDef,
  cw: number,
  ch: number,
  vp: Viewport,
  selected: boolean,
  p: Palette,
  bg: string,
  hoverPort: PinRef | null,
  sim?: SimView,
) {
  const isInput = portGroupDirection(def) === 'input'
  const ports = isInput ? inputPorts(parentDef.ports) : outputPorts(parentDef.ports)
  const widthFor = (port: Port) => pinWidth(parentDef, { instanceId: instance.id, portId: port.id })
  drawPortGroupBox(ctx, isInput, ports, instance.pos, widthFor, cw, ch, vp, selected, p, bg, hoverPort, instance.id, sim, false)
}

/** Core port-group drawing, given the pins, their position, and a width resolver. */
export function drawPortGroupBox(
  ctx: CanvasRenderingContext2D,
  isInput: boolean,
  ports: Port[],
  pos: { x: number; y: number },
  widthFor: (port: Port) => number,
  cw: number,
  ch: number,
  vp: Viewport,
  selected: boolean,
  p: Palette,
  bg: string,
  hoverPort: PinRef | null,
  instanceId: string,
  sim?: SimView,
  allowInversion = true,
) {
  const widths = ports.map(widthFor)
  const { w, h } = sizeForPorts(widths)
  const b = { x: pos.x - w / 2, y: pos.y - h / 2, w, h }

  if (selected) {
    const tl = w2s(b.x - 6, b.y - 6, cw, ch, vp)
    strokeDashedRect(ctx, tl.x, tl.y, (b.w + 12) * vp.zoom, (b.h + 12) * vp.zoom, p.selection)
  }

  const tl = w2s(b.x, b.y, cw, ch, vp)
  drawRoundedBox(ctx, tl.x, tl.y, b.w * vp.zoom, b.h * vp.zoom, 4 * vp.zoom, p.compositeFill, p.gateStroke)

  ctx.font = `${10 * vp.zoom}px system-ui, sans-serif`
  ctx.textBaseline = 'middle'
  ports.forEach((port, idx) => {
    const y = pos.y + sidePinOffset(widths, idx)
    const x = pos.x + (isInput ? w / 2 : -w / 2)
    const s = w2s(x, y, cw, ch, vp)
    const hovered = !!hoverPort && hoverPort.instanceId === instanceId && hoverPort.portId === port.id
    const signalColor = sim?.colorOf(instanceId, port.id)
    drawPin(ctx, s, widthFor(port), isInput ? p.pinHover : p.pin, allowInversion ? port.inverted ?? false : false, !isInput, vp, p, bg, hovered, signalColor)
    const offset = PIN_LABEL_GAP * vp.zoom
    ctx.fillStyle = p.text
    if (isInput) {
      ctx.textAlign = 'right'
      ctx.fillText(port.name, s.x - offset, s.y)
    } else {
      ctx.textAlign = 'left'
      ctx.fillText(port.name, s.x + offset, s.y)
    }
  })
}

export { drawInstance, drawJoinpointHalo, drawJoinpointNode, drawPortGroup }
