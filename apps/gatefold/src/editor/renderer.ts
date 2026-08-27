import type {ComponentDef, Design, Instance, Palette, PinRef, Port, SevenSegMode, Signal} from '@gatefold/model'
import {inputPorts, invertSignal, isPortGroupDef, outputPorts, pinKey, portGroupDirection, portWidth, primitiveOf, sevenSegDigits, sevenSegGeometry, sevenSegPositionCount} from '@gatefold/model'
import {
    arrayIndicatorLanes,
    busWireOffsets,
    instanceBodySize,
    instanceBounds,
    isNeutralPin,
    pinRadiusWorld,
    pinWidth,
    portPosition,
    SEVEN_SEG_DIGIT_H,
    SEVEN_SEG_DIGIT_W,
    SEVEN_SEG_GAP,
    SEVEN_SEG_PAD,
    sevenSegLaneCount,
    sidePinOffset,
    sizeForPorts,
    undeterminedHint,
} from './geometry'
import {wirePath} from './routing'
import {canvasVectorContext} from './canvasVector'
import {w2s} from './viewport'
import type {PendingWire, Rect, Viewport} from '../state/editorStore'

/**
 * Canvas renderer. `drawScene` is a pure-ish function of the current design,
 * viewport, selection, and palette — it reads no store state directly so it can be
 * redrawn deterministically. Draw order: background → grid → wires → instances →
 * hover highlight → marquee.
 */

/** Simulation view callbacks: resolve a signal color/value for a pin (and bus lane). */
export interface SimView {
    colorOf: (instanceId: string, portId: string, lane?: number) => string | undefined
    valueOf: (instanceId: string, portId: string) => Signal | undefined
    signalOf: (instanceId: string, portId: string) => Signal[] | undefined
}

const GRID = 24
const WIRE_WIDTH = 1.5
/** Extra halo width on each side of a wire, in screen pixels (zoom-independent). */
const HALO_MARGIN = 3

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

/** Draw a small tooltip label (e.g. the bus arity) near a screen point. */
function drawTooltip(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, p: Palette) {
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

/** Draw a filled rounded rectangle with a stroke. */
function drawRoundedBox(
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
function drawUndetermined(ctx: CanvasRenderingContext2D, cx: number, cy: number, h: number, p: Palette) {
    ctx.fillStyle = p.text
    ctx.font = `${Math.max(16, h * 0.4)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('?', cx, cy)
}

/** Stroke a dashed rectangle (selection / marquee outline). */
function strokeDashedRect(
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

function drawPorts(
    ctx: CanvasRenderingContext2D,
    design: Design,
    parentDef: ComponentDef,
    instance: Instance,
    def: ComponentDef,
    w: number,
    h: number,
    vp: Viewport,
    p: Palette,
    bg: string,
    hoverPort: PinRef | null,
    sim?: SimView,
) {
    const drawPort = (port: Port, color: string, bubbleOnLeft: boolean) => {
        const pos = portPosition(design, parentDef, instance, def, port.id)
        const s = w2s(pos.x, pos.y, w, h, vp)
        const width = pinWidth(design, parentDef, {instanceId: instance.id, portId: port.id})
        const hovered = !!hoverPort && hoverPort.instanceId === instance.id && hoverPort.portId === port.id
        const signalColor = sim?.colorOf(instance.id, port.id)
        drawPin(ctx, s, width, color, port.inverted ?? false, bubbleOnLeft, vp, p, bg, hovered, signalColor)
    }

    for (const port of inputPorts(def)) drawPort(port, p.pin, true)
    for (const port of outputPorts(def)) drawPort(port, p.pinHover, false)
}

/**
 * Draw a primitive's terminal names inside its body, next to each pin. Used by primitives
 * whose terminals have distinct purposes (e.g. the DFF's D/CLK/RST), so the pins are
 * self-explanatory without hovering.
 */
function drawTerminalLabels(
    ctx: CanvasRenderingContext2D,
    design: Design,
    parentDef: ComponentDef,
    instance: Instance,
    def: ComponentDef,
    cw: number,
    ch: number,
    vp: Viewport,
    p: Palette,
) {
    ctx.fillStyle = p.text
    ctx.font = `${9 * vp.zoom}px system-ui, sans-serif`
    ctx.textBaseline = 'middle'
    const gap = 8 * vp.zoom
    for (const port of inputPorts(def)) {
        const pos = portPosition(design, parentDef, instance, def, port.id)
        const ps = w2s(pos.x, pos.y, cw, ch, vp)
        ctx.textAlign = 'left'
        ctx.fillText(port.name, ps.x + gap, ps.y)
    }
    for (const port of outputPorts(def)) {
        const pos = portPosition(design, parentDef, instance, def, port.id)
        const ps = w2s(pos.x, pos.y, cw, ch, vp)
        ctx.textAlign = 'right'
        ctx.fillText(port.name, ps.x - gap, ps.y)
    }
}

function drawInstance(
    ctx: CanvasRenderingContext2D,
    design: Design,
    parentDef: ComponentDef,
    instance: Instance,
    def: ComponentDef,
    cw: number,
    ch: number,
    vp: Viewport,
    selected: boolean,
    p: Palette,
    bg: string,
    hoverPort: PinRef | null,
    sim?: SimView,
) {
    const {w, h} = instanceBodySize(design, parentDef, instance, def)
    const s = w2s(instance.pos.x, instance.pos.y, cw, ch, vp)

    if (selected) {
        const b = instanceBounds(design, parentDef, instance, def, 6)
        const tl = w2s(b.x, b.y, cw, ch, vp)
        strokeDashedRect(ctx, tl.x, tl.y, b.w * vp.zoom, b.h * vp.zoom, p.selection)
    }

    if (def.kind === 'composite') {
        const l = s.x - (w / 2) * vp.zoom
        const t = s.y - (h / 2) * vp.zoom
        drawRoundedBox(ctx, l, t, w * vp.zoom, h * vp.zoom, 6 * vp.zoom, p.compositeFill, p.gateStroke)
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

        const drawPortLabel = (port: Port, align: CanvasTextAlign) => {
            const pos = portPosition(design, parentDef, instance, def, port.id)
            const ps = w2s(pos.x, pos.y, cw, ch, vp)
            const offset = pinLabelOffset(port.inverted ?? false, vp.zoom)
            ctx.textAlign = align
            const x = align === 'right' ? ps.x - offset : ps.x + offset
            ctx.fillText(port.name, x, ps.y)
        }

        for (const port of inputPorts(def)) {
            drawPortLabel(port, 'right')
        }
        for (const port of outputPorts(def)) {
            drawPortLabel(port, 'left')
        }
    } else {
        if (def.primitive) {
            const pinRadiusOf = (portId: string) =>
                pinRadiusWorld(pinWidth(design, parentDef, {instanceId: instance.id, portId})) * vp.zoom
            if (def.primitive === 'switch-array' || def.primitive === 'led-array') {
                drawArrayBody(ctx, design, parentDef, instance, def, s.x, s.y, w * vp.zoom, h * vp.zoom, cw, ch, vp, p, sim)
            } else if (def.primitive === 'seven-seg') {
                drawSevenSegBody(ctx, design, parentDef, instance, def, s.x, s.y, h * vp.zoom, vp, p, sim)
            } else {
                primitiveOf(def.primitive).draw(canvasVectorContext(ctx), {
                    x: s.x,
                    y: s.y,
                    w: w * vp.zoom,
                    h: h * vp.zoom,
                    palette: p,
                    pinRadius: pinRadiusOf,
                })
            }
        }
        // Terminal names inside the body for primitives with distinct terminals (DFF).
        if (def.primitive && primitiveOf(def.primitive).showTerminalNames?.()) {
            drawTerminalLabels(ctx, design, parentDef, instance, def, cw, ch, vp, p)
        }
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

    drawPorts(ctx, design, parentDef, instance, def, cw, ch, vp, p, bg, hoverPort, sim)
}


/**
 * A port group: a single rectangle carrying all of a composite's inputs (or outputs).
 * `input-port` draws green source pins on its right edge; `output-port` draws sink
 * pins on its left edge. Movable as one unit.
 */
function drawPortGroup(
    ctx: CanvasRenderingContext2D,
    design: Design,
    parentDef: ComponentDef,
    instance: Instance,
    def: ComponentDef,
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
    const ports = isInput ? inputPorts(parentDef) : outputPorts(parentDef)
    const widthFor = (port: Port) => pinWidth(design, parentDef, {instanceId: instance.id, portId: port.id})
    drawPortGroupBox(ctx, isInput, ports, instance.pos, widthFor, cw, ch, vp, selected, p, bg, hoverPort, instance.id, sim)
}

/** Core port-group drawing, given the pins, their position, and a width resolver. */
function drawPortGroupBox(
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
) {
    const widths = ports.map(widthFor)
    const {w, h} = sizeForPorts(widths)
    const b = {x: pos.x - w / 2, y: pos.y - h / 2, w, h}

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
        drawPin(ctx, s, widthFor(port), isInput ? p.pinHover : p.pin, port.inverted ?? false, !isInput, vp, p, bg, hovered, signalColor)
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

/** Fill a polygon given as a list of [x, y] points. */
function fillPolygon(ctx: CanvasRenderingContext2D, poly: [number, number][]): void {
    ctx.beginPath()
    ctx.moveTo(poly[0][0], poly[0][1])
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1])
    ctx.closePath()
    ctx.fill()
}

/** Draw a seven-seg body, one display slot per the primitive's mode, or "?" when undetermined. */
function drawSevenSegBody(
    ctx: CanvasRenderingContext2D,
    design: Design,
    parentDef: ComponentDef,
    instance: Instance,
    def: ComponentDef,
    cx: number,
    cy: number,
    h: number,
    vp: Viewport,
    p: Palette,
    sim?: SimView,
) {
    const lanes = sevenSegLaneCount(design, parentDef, instance, def)
    const mode = (instance.props?.mode as SevenSegMode | undefined) ?? 'HEX'
    const positions = lanes === null ? 1 : sevenSegPositionCount(lanes, mode)
    const zoom = vp.zoom
    const digitW = SEVEN_SEG_DIGIT_W * zoom
    const digitH = SEVEN_SEG_DIGIT_H * zoom
    const gap = SEVEN_SEG_GAP * zoom
    const pad = SEVEN_SEG_PAD * zoom
    const totalW = pad * 2 + positions * digitW + (positions - 1) * gap

    // Green body with a border.
    drawRoundedBox(ctx, cx - totalW / 2, cy - h / 2, totalW, h, 6, '#0d2818', '#3fb950')

    if (lanes === null) {
        drawUndetermined(ctx, cx, cy, h, p)
        return
    }

    const startX = cx - totalW / 2 + pad + digitW / 2

    const order = instance.props?.order === 'desc'
    let raw = sim ? sim.signalOf(instance.id, inputPorts(def)[0].id) : undefined
    if (raw && inputPorts(def)[0]?.inverted) raw = raw.map(invertSignal)
    const bits = raw ? (order ? [...raw].reverse() : raw) : []
    const masks = bits.length > 0 ? sevenSegDigits(bits, mode) : Array.from({ length: positions }, () => null)

    for (let d = 0; d < positions; d++) {
        const dx = startX + d * (digitW + gap)
        const segs = sevenSegGeometry({ x: dx, y: cy, w: digitW, h: digitH, palette: p })

        // Dim skeleton.
        ctx.fillStyle = 'rgba(63, 185, 80, 0.1)'
        for (const poly of segs) fillPolygon(ctx, poly)

        const pattern = masks[d]
        if (!pattern) continue
        ctx.fillStyle = '#fcd34d'
        for (let i = 0; i < 7; i++) {
            if (!pattern[i]) continue
            fillPolygon(ctx, segs[i])
        }
    }
}

/** Draw an array body (row of LEDs or switches), or a "?" box when its bus width is undetermined. */
function drawArrayBody(
    ctx: CanvasRenderingContext2D,
    design: Design,
    parentDef: ComponentDef,
    instance: Instance,
    def: ComponentDef,
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
    const isSwitch = def.primitive === 'switch-array'
    const initialOn = isSwitch && instance.props?.initialValue === true

    drawRoundedBox(ctx, cx - w / 2, cy - h / 2, w, h, 6, p.gateFill, p.gateStroke)

    const lanes = arrayIndicatorLanes(design, parentDef, instance, def, vp.zoom)
    if (!lanes) {
        drawUndetermined(ctx, cx, cy, h, p)
        return
    }

    for (let i = 0; i < lanes.length; i++) {
        const y = w2s(instance.pos.x, lanes[i].y, cw, ch, vp).y
        const r = lanes[i].r * vp.zoom
        let sig: Signal | undefined
        if (sim) {
            const port = def.ports.length > 1 ? def.ports[i] : def.ports[0]
            if (def.ports.length > 1) {
                const portId = port?.id
                if (portId) sig = sim.valueOf(instance.id, portId)
            } else {
                sig = port ? sim.signalOf(instance.id, port.id)?.[i] : undefined
            }
            // Apply the terminal's inversion. For a switch this undoes the engine's output
            // inversion (so the circle shows the toggle state); for an LED it applies the
            // input inversion (so the lamp lights on the inverted signal).
            if (sig !== undefined && port?.inverted) sig = invertSignal(sig)
        } else if (initialOn) {
            // Show the initial (pre-simulation) on state in design mode.
            sig = 1
        }
        drawArrayCell(ctx, cx, y, r, isSwitch, sig, p)
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

export function drawScene(
    ctx: CanvasRenderingContext2D,
    cw: number,
    ch: number,
    design: Design,
    vp: Viewport,
    selectedIds: string[],
    defId: string,
    editingTemplate: boolean,
    marquee: Rect | null,
    pendingWire: PendingWire | null,
    hoverPort: PinRef | null,
    p: Palette,
    sim?: SimView,
) {
    const def = design.defs[defId]
    const bg = sim ? p.simBg : editingTemplate ? p.templateBg : p.bg

    ctx.fillStyle = bg
    ctx.fillRect(0, 0, cw, ch)
    drawGrid(ctx, cw, ch, vp, p)

    if (!def) return

    // Primitives have no editable internals — show a centered placeholder plus their
    // input/output port groups.
    if (def.kind === 'primitive') {
        const W = 220
        const H = 100
        const s = w2s(vp.x, vp.y, cw, ch, vp)
        drawRoundedBox(ctx, s.x - (W / 2) * vp.zoom, s.y - (H / 2) * vp.zoom, W * vp.zoom, H * vp.zoom, 8 * vp.zoom, p.compositeFill, p.gateStroke)
        ctx.fillStyle = p.text
        ctx.font = `${14 * vp.zoom}px system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('Internal circuitry', s.x, s.y)

        const margin = 60
        drawPortGroupBox(ctx, true, inputPorts(def), {
            x: vp.x - W / 2 - margin,
            y: vp.y
        }, (port) => portWidth(def, port), cw, ch, vp, false, p, bg, null, '')
        drawPortGroupBox(ctx, false, outputPorts(def), {
            x: vp.x + W / 2 + margin,
            y: vp.y
        }, (port) => portWidth(def, port), cw, ch, vp, false, p, bg, null, '')
        return
    }

    const instances = def.instances ?? []
    const byId = new Map(instances.map((i) => [i.id, i]))

    const resolveEndpoint = (ref: PinRef): { x: number; y: number } | null => {
        const inst = byId.get(ref.instanceId)
        if (!inst) return null
        const instDef = design.defs[inst.defId]
        if (!instDef) return null
        return portPosition(design, def, inst, instDef, ref.portId)
    }

    interface Trace {
        s: { x: number; y: number }
        c1: { x: number; y: number }
        c2: { x: number; y: number }
        e: { x: number; y: number }
        width: number
        undetermined: boolean
        from: PinRef
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
            width: pinWidth(design, def, conn.from),
            undetermined: isNeutralPin(design, def, conn.from),
            from: conn.from,
        }
        // Group by source so fan-out wires render as one bundle (all halos, then all
        // lines) rather than cutting into each other at their shared terminal.
        const key = pinKey(conn.from)
        const group = groups.get(key)
        if (group) group.push(trace)
        else groups.set(key, [trace])
    }

    for (const traces of groups.values()) {
        if (traces[0].undetermined) {
            // Width not yet determined: a thin dashed single wire.
            for (const t of traces) {
                ctx.beginPath()
                ctx.moveTo(t.s.x, t.s.y)
                ctx.bezierCurveTo(t.c1.x, t.c1.y, t.c2.x, t.c2.y, t.e.x, t.e.y)
                ctx.strokeStyle = p.wire
                ctx.lineWidth = WIRE_WIDTH * vp.zoom
                ctx.setLineDash([5, 5])
                ctx.stroke()
                ctx.setLineDash([])
            }
            continue
        }
        // Render each bus as its individual single wires, spread vertically across the
        // pin marker (first lane at the top, last at the bottom). Control points move
        // with their endpoint, keeping the same horizontal offset as a single wire.
        const wires: { s: { x: number; y: number }; c1: { x: number; y: number }; c2: { x: number; y: number }; e: { x: number; y: number }; color: string }[] = []
        for (const t of traces) {
            const offsets = busWireOffsets(t.width)
            for (let i = 0; i < offsets.length; i++) {
                const o = offsets[i] * vp.zoom
                wires.push({
                    s: { x: t.s.x, y: t.s.y + o },
                    c1: { x: t.c1.x, y: t.c1.y + o },
                    c2: { x: t.c2.x, y: t.c2.y + o },
                    e: { x: t.e.x, y: t.e.y + o },
                    color: sim?.colorOf(t.from.instanceId, t.from.portId, i) ?? p.wire,
                })
            }
        }
        for (const w of wires) strokeWire(ctx, w.s, w.c1, w.c2, w.e, bg, WIRE_WIDTH * vp.zoom + HALO_MARGIN * 2)
        for (const w of wires) strokeWire(ctx, w.s, w.c1, w.c2, w.e, w.color, WIRE_WIDTH * vp.zoom)
    }

    // Preview of a wire currently being drawn (dashed, accent color). A bus drag draws
    // one dashed lane per wire: they spread across the source marker and either spread
    // across a hovered sink marker or converge on the cursor.
    if (pendingWire) {
        const a = resolveEndpoint(pendingWire.from)
        if (a) {
            const width = pinWidth(design, def, pendingWire.from)
            const offsets = busWireOffsets(width)
            const target = hoverPort ? resolveEndpoint(hoverPort) : null
            ctx.strokeStyle = p.selection
            ctx.lineWidth = WIRE_WIDTH * vp.zoom
            ctx.setLineDash([5, 4])
            for (const dy of offsets) {
                const start = {x: a.x, y: a.y + dy}
                const end = target ? {x: target.x, y: target.y + dy} : {x: pendingWire.x, y: pendingWire.y}
                const path = wirePath(start, end)
                const s = w2s(path.start.x, path.start.y, cw, ch, vp)
                const c1 = w2s(path.c1.x, path.c1.y, cw, ch, vp)
                const c2 = w2s(path.c2.x, path.c2.y, cw, ch, vp)
                const e = w2s(path.end.x, path.end.y, cw, ch, vp)
                ctx.beginPath()
                ctx.moveTo(s.x, s.y)
                ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, e.x, e.y)
                ctx.stroke()
            }
            ctx.setLineDash([])
        }
    }

    for (const inst of instances) {
        const instDef = design.defs[inst.defId]
        if (!instDef) continue
        if (isPortGroupDef(instDef)) {
            drawPortGroup(ctx, design, def, inst, instDef, cw, ch, vp, selectedIds.includes(inst.id), p, bg, hoverPort, sim)
        } else {
            drawInstance(ctx, design, def, inst, instDef, cw, ch, vp, selectedIds.includes(inst.id), p, bg, hoverPort, sim)
        }
    }

    // Tooltip showing the arity of a bus terminal (or a hint when undetermined).
    if (hoverPort) {
        const pos = resolveEndpoint(hoverPort)
        if (pos) {
            const s = w2s(pos.x, pos.y, cw, ch, vp)
            const width = pinWidth(design, def, hoverPort)
            if (width > 1) {
                drawTooltip(ctx, `×${width}`, s.x, s.y, p)
            } else {
                const hint = undeterminedHint(design, def, hoverPort)
                if (hint) drawTooltip(ctx, hint, s.x, s.y, p)
            }
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
