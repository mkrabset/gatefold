import type { ChildDef, Instance, Palette, PinRef } from '@gatefold/model'
import { childPorts, childPrimitive, inputPorts, isPortGroupDef, outputPorts, pinKey, portWidth, UnionFind } from '@gatefold/model'
import {
  busWireOffsets,
  isNeutralPin,
  pinWidth,
  portPosition,
  undeterminedHint,
} from './geometry'
import { wirePath } from './routing'
import { w2s } from './viewport'
import { HALO_MARGIN, WIRE_WIDTH, drawGrid, drawRoundedBox, drawTooltip, strokeWire } from './draw/shapes'
import { drawInstance, drawJoinpointHalo, drawJoinpointNode, drawPortGroup, drawPortGroupBox } from './draw/instances'
import type { CutLine, PendingWire, Rect, SimView, Viewport } from './types'

/**
 * Canvas renderer. `drawScene` is a pure-ish function of the current def, viewport,
 * selection, and palette — it reads no store state directly so it can be redrawn
 * deterministically. Draw order: background → grid → wires → instances → hover
 * highlight → marquee. Instance/pin/probe drawing lives in `draw/`; this module is
 * the orchestration (wiring nets, overlays, HUD).
 */

export function drawScene(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  def: ChildDef,
  vp: Viewport,
  selectedIds: string[],
  editingTemplate: boolean,
  atRoot: boolean,
  marquee: Rect | null,
  pendingWire: PendingWire | null,
  cutLine: CutLine | null,
  hoverPort: PinRef | null,
  p: Palette,
  sim?: SimView,
) {
  const bg = sim ? p.simBg : editingTemplate ? p.templateBg : p.bg

  ctx.fillStyle = bg
  ctx.fillRect(0, 0, cw, ch)
  drawGrid(ctx, cw, ch, vp, p)

  // Primitives have no editable internals — show a centered placeholder plus their
  // input/output port groups.
  if (def.kind !== 'composite') {
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
    drawPortGroupBox(ctx, true, inputPorts(childPorts(def)), {
      x: vp.x - W / 2 - margin,
      y: vp.y,
    }, (port) => portWidth(def, port), cw, ch, vp, false, p, bg, null, '')
    drawPortGroupBox(ctx, false, outputPorts(childPorts(def)), {
      x: vp.x + W / 2 + margin,
      y: vp.y,
    }, (port) => portWidth(def, port), cw, ch, vp, false, p, bg, null, '')
    return
  }

  const instances = def.instances
  const byId = new Map(instances.map((i) => [i.id, i]))

  const resolveEndpoint = (ref: PinRef): { x: number; y: number } | null => {
    const inst = byId.get(ref.instanceId)
    if (!inst) return null
    return portPosition(def, inst, inst.def, ref.portId)
  }

  const isJoin = (ref: PinRef): boolean => {
    const inst = byId.get(ref.instanceId)
    const instDef = inst?.def
    return childPrimitive(instDef ?? { kind: 'builtin', primitive: 'buffer' }) === 'join-point'
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

  // Union-find over pins: connections share a net, and a join-point joins its input
  // and output so its connected wires render as one continuous net.
  const uf = new UnionFind()
  for (const c of def.connections) uf.union(pinKey(c.from), pinKey(c.to))

  const joinPoints: Instance[] = []
  for (const inst of instances) {
    if (childPrimitive(inst.def) === 'join-point') {
      uf.union(pinKey({ instanceId: inst.id, portId: 'in:0' }), pinKey({ instanceId: inst.id, portId: 'out:0' }))
      joinPoints.push(inst)
    }
  }

  const groups = new Map<string, Trace[]>()
  for (const conn of def.connections) {
    // Hide a connection that is being re-targeted (its preview replaces it).
    if (pendingWire && conn.id === pendingWire.originalId) continue
    const a = resolveEndpoint(conn.from)
    const b = resolveEndpoint(conn.to)
    if (!a || !b) continue
    const path = wirePath(a, b, { fromJoin: isJoin(conn.from), toJoin: isJoin(conn.to) })
    const trace: Trace = {
      s: w2s(path.start.x, path.start.y, cw, ch, vp),
      c1: w2s(path.c1.x, path.c1.y, cw, ch, vp),
      c2: w2s(path.c2.x, path.c2.y, cw, ch, vp),
      e: w2s(path.end.x, path.end.y, cw, ch, vp),
      width: pinWidth(def, conn.from),
      undetermined: isNeutralPin(def, conn.from),
      from: conn.from,
    }
    const key = uf.find(pinKey(conn.from))
    const group = groups.get(key)
    if (group) group.push(trace)
    else groups.set(key, [trace])
  }

  // Associate each join-point with its net (group key), or leave it unconnected.
  const joinPointsByGroup = new Map<string, Instance[]>()
  const unconnectedJoinPoints: Instance[] = []
  for (const jp of joinPoints) {
    const key = uf.find(pinKey({ instanceId: jp.id, portId: 'out:0' }))
    if (groups.has(key)) {
      const arr = joinPointsByGroup.get(key)
      if (arr) arr.push(jp)
      else joinPointsByGroup.set(key, [jp])
    } else {
      unconnectedJoinPoints.push(jp)
    }
  }

  for (const [key, traces] of groups) {
    const dots = joinPointsByGroup.get(key) ?? []
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
    for (const jp of dots) {
      const s = w2s(jp.pos.x, jp.pos.y, cw, ch, vp)
      drawJoinpointHalo(ctx, s.x, s.y, vp, bg)
    }
    for (const w of wires) strokeWire(ctx, w.s, w.c1, w.c2, w.e, w.color, WIRE_WIDTH * vp.zoom)
    for (const jp of dots) {
      drawJoinpointNode(ctx, def, jp, cw, ch, vp, selectedIds.includes(jp.id), p, !!hoverPort && hoverPort.instanceId === jp.id, sim)
    }
  }

  // Unconnected join-points (no wires) still get a halo + dot.
  for (const jp of unconnectedJoinPoints) {
    const s = w2s(jp.pos.x, jp.pos.y, cw, ch, vp)
    drawJoinpointHalo(ctx, s.x, s.y, vp, bg)
    drawJoinpointNode(ctx, def, jp, cw, ch, vp, selectedIds.includes(jp.id), p, !!hoverPort && hoverPort.instanceId === jp.id, sim)
  }

  // Preview of a wire currently being drawn (dashed, accent color). A bus drag draws
  // one dashed lane per wire: they spread across the source marker and either spread
  // across a hovered sink marker or converge on the cursor.
  if (pendingWire) {
    const a = resolveEndpoint(pendingWire.from)
    if (a) {
      const width = pinWidth(def, pendingWire.from)
      const offsets = busWireOffsets(width)
      const target = hoverPort ? resolveEndpoint(hoverPort) : null
      ctx.strokeStyle = p.selection
      ctx.lineWidth = WIRE_WIDTH * vp.zoom
      ctx.setLineDash([5, 4])
      for (const dy of offsets) {
        const start = { x: a.x, y: a.y + dy }
        const end = target ? { x: target.x, y: target.y + dy } : { x: pendingWire.x, y: pendingWire.y }
        const path = wirePath(start, end, { fromJoin: isJoin(pendingWire.from), toJoin: !!hoverPort && isJoin(hoverPort) })
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

  // Imaginary cut line (Ctrl/Cmd+drag): a dashed straight line under the instances.
  if (cutLine) {
    const a = w2s(cutLine.start.x, cutLine.start.y, cw, ch, vp)
    const b = w2s(cutLine.end.x, cutLine.end.y, cw, ch, vp)
    ctx.strokeStyle = p.selection
    ctx.lineWidth = WIRE_WIDTH * vp.zoom
    ctx.setLineDash([5, 4])
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    ctx.setLineDash([])
  }

  for (const inst of instances) {
    const instDef = inst.def
    // Join-points are rendered with their net in the wire pass above.
    if (childPrimitive(instDef) === 'join-point') continue
    if (isPortGroupDef(instDef)) {
      drawPortGroup(ctx, def, inst, instDef, cw, ch, vp, selectedIds.includes(inst.id), p, bg, hoverPort, sim)
    } else {
      drawInstance(ctx, def, inst, instDef, cw, ch, vp, selectedIds.includes(inst.id), p, bg, hoverPort, atRoot, sim)
    }
  }

  // Tooltip showing the arity of a bus terminal (or a hint when undetermined).
  if (hoverPort) {
    const pos = resolveEndpoint(hoverPort)
    if (pos) {
      const s = w2s(pos.x, pos.y, cw, ch, vp)
      const width = pinWidth(def, hoverPort)
      if (width > 1) {
        drawTooltip(ctx, `×${width}`, s.x, s.y, p)
      } else {
        const hint = undeterminedHint(def, hoverPort)
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

  // Simulation HUD: the current speed, top-left with a subtle backdrop.
  if (sim) {
    ctx.font = '12px system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const m = 12
    const px = 10
    const h = 24
    const w = ctx.measureText(sim.speedLabel).width + px * 2
    ctx.globalAlpha = 0.8
    ctx.fillStyle = p.bg
    ctx.fillRect(m, m, w, h)
    ctx.globalAlpha = 1
    ctx.fillStyle = p.text
    ctx.fillText(sim.speedLabel, m + px, m + h / 2)
  }
}
