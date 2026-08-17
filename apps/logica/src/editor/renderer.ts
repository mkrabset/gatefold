import type {ComponentDef, Design, Instance, Palette, PinRef, Port} from '@logica/model'
import {inputPorts, isPortGroupDef, outputPorts, portGroupDirection, portWidth, primitiveOf} from '@logica/model'
import {
    instanceBodySize,
    instanceBounds,
    isNeutralPin,
    pinRadiusWorld,
    pinWidth,
    portPosition,
    sizeForPorts,
    undeterminedHint,
} from './geometry'
import {wirePath} from './routing'
import {canvasVectorContext} from './canvasVector'
import type {HoverPort, PendingWire, Rect, Viewport} from '../state/editorStore'

/**
 * Canvas renderer. `drawScene` is a pure-ish function of the current design,
 * viewport, selection, and palette — it reads no store state directly so it can be
 * redrawn deterministically. Draw order: background → grid → wires → instances →
 * hover highlight → marquee.
 */

const GRID = 24
const WIRE_WIDTH = 1.5
const HALO_WIDTH = 2.5

/** Pin radius, scaled up for bus terminals (proportional to width) and the zoom. */
function pinRadius(width: number, zoom: number): number {
    return pinRadiusWorld(width) * zoom
}

/** Draw the hollow inversion bubble (a ring 50% larger than the pin dot). */
function drawInversionRing(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    zoom: number,
    p: Palette,
) {
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.strokeStyle = p.gateStroke
    ctx.lineWidth = 1.5 * zoom
    ctx.stroke()
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

function w2s(wx: number, wy: number, w: number, h: number, vp: Viewport) {
    return {
        x: w / 2 + (wx - vp.x) * vp.zoom,
        y: h / 2 + (wy - vp.y) * vp.zoom,
    }
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
) {

    const drawPort = (port: Port, fillStyle: string) => {
        const pos = portPosition(design, parentDef, instance, def, port.id)
        const s = w2s(pos.x, pos.y, w, h, vp)
        const width = pinWidth(design, parentDef, {instanceId: instance.id, portId: port.id})
        ctx.beginPath()
        ctx.arc(s.x, s.y, pinRadius(width, vp.zoom), 0, Math.PI * 2)
        ctx.fillStyle = fillStyle
        ctx.fill()
        if (port.inverted) drawInversionRing(ctx, s.x, s.y, 1.5 * pinRadius(width, vp.zoom), vp.zoom, p)
    }

    for (const port of inputPorts(def)) {
        drawPort(port, p.pin)
    }
    for (const port of outputPorts(def)) {
        drawPort(port, p.pinHover)
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
) {
    const {w, h} = instanceBodySize(design, parentDef, instance, def)
    const s = w2s(instance.pos.x, instance.pos.y, cw, ch, vp)

    if (selected) {
        const b = instanceBounds(design, parentDef, instance, def, 6)
        const tl = w2s(b.x, b.y, cw, ch, vp)
        ctx.strokeStyle = p.selection
        ctx.lineWidth = 1
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

        const drawPortLabel = (port: Port, align: CanvasTextAlign) => {
            const pos = portPosition(design, parentDef, instance, def, port.id)
            const ps = w2s(pos.x, pos.y, cw, ch, vp)
            const width = pinWidth(design, parentDef, {instanceId: instance.id, portId: port.id})
            const offset = ((port.inverted ? 1.5 : 1) * pinRadiusWorld(width) + 10) * vp.zoom
            ctx.textAlign = align
            const xOffset = align === 'right' ? ps.x + offset : ps.x - offset
            ctx.fillText(port.name, xOffset, ps.y)
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
            primitiveOf(def.primitive).draw(canvasVectorContext(ctx), {
                x: s.x,
                y: s.y,
                w: w * vp.zoom,
                h: h * vp.zoom,
                palette: p,
                pinRadius: pinRadiusOf,
            })
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

    drawPorts(ctx, design, parentDef, instance, def, cw, ch, vp, p)
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
) {
    const isInput = portGroupDirection(def) === 'input'
    const ports = isInput ? inputPorts(parentDef) : outputPorts(parentDef)
    const widthFor = (port: Port) => pinWidth(design, parentDef, {instanceId: instance.id, portId: port.id})
    drawPortGroupBox(ctx, isInput, ports, instance.pos, widthFor, cw, ch, vp, selected, p)
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
) {
    const n = ports.length
    const rMax = ports.reduce((m, p) => Math.max(m, pinRadiusWorld(widthFor(p))), 0)
    const {w, h} = sizeForPorts(n, rMax)
    const b = {x: pos.x - w / 2, y: pos.y - h / 2, w, h}

    if (selected) {
        const tl = w2s(b.x - 6, b.y - 6, cw, ch, vp)
        ctx.strokeStyle = p.selection
        ctx.lineWidth = 1
        ctx.setLineDash([4, 3])
        ctx.strokeRect(tl.x, tl.y, (b.w + 12) * vp.zoom, (b.h + 12) * vp.zoom)
        ctx.setLineDash([])
    }

    const tl = w2s(b.x, b.y, cw, ch, vp)
    ctx.beginPath()
    ctx.roundRect(tl.x, tl.y, b.w * vp.zoom, b.h * vp.zoom, 4 * vp.zoom)
    ctx.fillStyle = p.compositeFill
    ctx.fill()
    ctx.strokeStyle = p.gateStroke
    ctx.lineWidth = 1.5
    ctx.stroke()

    ctx.font = `${10 * vp.zoom}px system-ui, sans-serif`
    ctx.textBaseline = 'middle'
    ports.forEach((port, idx) => {
        const y = n <= 1 ? pos.y : pos.y - h / 2 + ((idx + 1) * h) / (n + 1)
        const x = pos.x + (isInput ? w / 2 : -w / 2)
        const s = w2s(x, y, cw, ch, vp)
        const radius = pinRadius(widthFor(port), vp.zoom)
        ctx.beginPath()
        ctx.arc(s.x, s.y, radius, 0, Math.PI * 2)
        ctx.fillStyle = isInput ? p.pinHover : p.pin
        ctx.fill()
        if (port.inverted) drawInversionRing(ctx, s.x, s.y, 1.5 * radius, vp.zoom, p)
        const offset = ((port.inverted ? 1.5 : 1) * pinRadiusWorld(widthFor(port)) + 6) * vp.zoom
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

function pinKey(ref: PinRef): string {
    return `${ref.instanceId}:${ref.portId}`
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
    hoverPort: HoverPort | null,
    p: Palette,
) {
    const def = design.defs[defId]
    const bg = editingTemplate ? p.templateBg : p.bg

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
        ctx.beginPath()
        ctx.roundRect(s.x - (W / 2) * vp.zoom, s.y - (H / 2) * vp.zoom, W * vp.zoom, H * vp.zoom, 8 * vp.zoom)
        ctx.fillStyle = p.compositeFill
        ctx.fill()
        ctx.strokeStyle = p.gateStroke
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.fillStyle = p.text
        ctx.font = `${14 * vp.zoom}px system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('Internal circuitry', s.x, s.y)

        const margin = 60
        drawPortGroupBox(ctx, true, inputPorts(def), {
            x: vp.x - W / 2 - margin,
            y: vp.y
        }, (port) => portWidth(def, port), cw, ch, vp, false, p)
        drawPortGroupBox(ctx, false, outputPorts(def), {
            x: vp.x + W / 2 + margin,
            y: vp.y
        }, (port) => portWidth(def, port), cw, ch, vp, false, p)
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
        for (const t of traces) strokeWire(ctx, t.s, t.c1, t.c2, t.e, bg, (WIRE_WIDTH * t.width + HALO_WIDTH * 2) * vp.zoom)
        for (const t of traces) strokeWire(ctx, t.s, t.c1, t.c2, t.e, p.wire, WIRE_WIDTH * t.width * vp.zoom)
    }

    // Preview of a wire currently being drawn (dashed, accent color).
    if (pendingWire) {
        const a = resolveEndpoint(pendingWire.from)
        if (a) {
            const path = wirePath(a, {x: pendingWire.x, y: pendingWire.y})
            const s = w2s(path.start.x, path.start.y, cw, ch, vp)
            const c1 = w2s(path.c1.x, path.c1.y, cw, ch, vp)
            const c2 = w2s(path.c2.x, path.c2.y, cw, ch, vp)
            const e = w2s(path.end.x, path.end.y, cw, ch, vp)
            ctx.beginPath()
            ctx.moveTo(s.x, s.y)
            ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, e.x, e.y)
            ctx.strokeStyle = p.selection
            ctx.lineWidth = WIRE_WIDTH * vp.zoom
            ctx.setLineDash([5, 4])
            ctx.stroke()
            ctx.setLineDash([])
        }
    }

    for (const inst of instances) {
        const instDef = design.defs[inst.defId]
        if (!instDef) continue
        if (isPortGroupDef(instDef)) {
            drawPortGroup(ctx, design, def, inst, instDef, cw, ch, vp, selectedIds.includes(inst.id), p)
        } else {
            drawInstance(ctx, design, def, inst, instDef, cw, ch, vp, selectedIds.includes(inst.id), p)
        }
    }

    // Highlight the hovered port: yellow = create a wire, orange = grab an existing one.
    if (hoverPort) {
        const pos = resolveEndpoint(hoverPort.ref)
        if (pos) {
            const s = w2s(pos.x, pos.y, cw, ch, vp)
            // 'inspect' is informational only (a bus terminal that can't be grabbed or
            // created from) — show the arity tooltip but no interaction ring.
            if (hoverPort.action !== 'inspect') {
                ctx.beginPath()
                ctx.arc(s.x, s.y, 6 * vp.zoom, 0, Math.PI * 2)
                ctx.strokeStyle = hoverPort.action === 'grab' ? p.grabHover : p.portHover
                ctx.lineWidth = 2 * vp.zoom
                ctx.stroke()
            }

            // Tooltip showing the arity of a bus terminal (or a hint when undetermined).
            const width = pinWidth(design, def, hoverPort.ref)
            if (width > 1) {
                drawTooltip(ctx, `×${width}`, s.x, s.y, p)
            } else {
                const hint = undeterminedHint(design, def, hoverPort.ref)
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
