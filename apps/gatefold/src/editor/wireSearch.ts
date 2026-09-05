import type { ComponentDef, Connection, Design, PinRef } from '@gatefold/model'
import { getDef, primitiveOf } from '@gatefold/model'
import { busWireOffsets, pinWidth, portPosition } from './geometry'
import { wirePath } from './routing'
import type { CubicBezier, Point } from './routing'

/**
 * Wire-by-crossing search: given a line segment, find the single-wire connection whose
 * bezier it crosses — but only when that crossing is unambiguous. Each single-wire
 * connection contributes one bezier; each bus contributes one bezier per lane. If the
 * segment crosses exactly one curve and that curve belongs to a single-wire connection
 * (width 1), the connection and the crossing point (world space) are returned. Any other
 * outcome (no crossing, multiple crossings, a bus lane, one wire crossed twice) returns
 * null.
 */

export interface WireHitResult {
  connection: Connection
  /** World-space point where the query segment crosses the wire's bezier. */
  point: Point
}

/** Flattening tolerance (world units): the polyline tracks the bezier within this. */
const FLATNESS = 0.25
/** Safety cap on recursive subdivision depth. */
const MAX_DEPTH = 12
/** Numerical epsilon for near-zero cross products. */
const EPS = 1e-9
/** Epsilon for merging duplicate crossing points (flattened-edge joints). */
const DEDUP_EPS = 1e-3

function isJoinpoint(def: ComponentDef): boolean {
  return def.kind === 'primitive' && primitiveOf(def.primitive).coincidentTerminals?.() === true
}

interface Endpoint {
  pos: Point
  join: boolean
}

function resolve(design: Design, parentDef: ComponentDef, ref: PinRef): Endpoint | null {
  if (parentDef.kind !== 'composite') return null
  const inst = parentDef.instances?.find((i) => i.id === ref.instanceId)
  if (!inst) return null
  const instDef = getDef(design, inst.defId)
  if (!instDef) return null
  return { pos: portPosition(design, parentDef, inst, instDef, ref.portId), join: isJoinpoint(instDef) }
}

// --- cubic flattening (de Casteljau) ---

function distToSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const len2 = abx * abx + aby * aby
  if (len2 < EPS) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2
  if (t < 0) t = 0
  else if (t > 1) t = 1
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby))
}

function isFlat(b: CubicBezier): boolean {
  return distToSegment(b.c1, b.start, b.end) <= FLATNESS && distToSegment(b.c2, b.start, b.end) <= FLATNESS
}

function mid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function split(b: CubicBezier): [CubicBezier, CubicBezier] {
  const m01 = mid(b.start, b.c1)
  const m12 = mid(b.c1, b.c2)
  const m23 = mid(b.c2, b.end)
  const m012 = mid(m01, m12)
  const m123 = mid(m12, m23)
  const m = mid(m012, m123)
  return [
    { start: b.start, c1: m01, c2: m012, end: m },
    { start: m, c1: m123, c2: m23, end: b.end },
  ]
}

/** Flatten a cubic into an ordered polyline, pushing each interior vertex onto `out`. */
function flatten(b: CubicBezier, depth: number, out: Point[]): void {
  if (isFlat(b) || depth >= MAX_DEPTH) {
    out.push(b.end)
    return
  }
  const [l, r] = split(b)
  flatten(l, depth + 1, out)
  flatten(r, depth + 1, out)
}

// --- segment intersection ---

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx
}

/** Intersection of segments (p,q) and (a,b), or null (parallel/collinear → null). */
function segmentIntersection(p: Point, q: Point, a: Point, b: Point): Point | null {
  const rx = q.x - p.x
  const ry = q.y - p.y
  const sx = b.x - a.x
  const sy = b.y - a.y
  const denom = cross(rx, ry, sx, sy)
  if (Math.abs(denom) < EPS) return null
  const qpx = a.x - p.x
  const qpy = a.y - p.y
  const t = cross(qpx, qpy, sx, sy) / denom
  const u = cross(qpx, qpy, rx, ry) / denom
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return { x: p.x + t * rx, y: p.y + t * ry }
}

/** All crossing points of a cubic with the segment (a, b), deduplicated. */
function curveIntersections(curve: CubicBezier, a: Point, b: Point): Point[] {
  const poly: Point[] = [curve.start]
  flatten(curve, 0, poly)
  const points: Point[] = []
  for (let i = 0; i < poly.length - 1; i++) {
    const p = segmentIntersection(poly[i], poly[i + 1], a, b)
    if (!p) continue
    if (!points.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < DEDUP_EPS)) points.push(p)
  }
  return points
}

/** A bezier shifted vertically (bus lanes are the base wire spread across the marker). */
function shiftY(b: CubicBezier, dy: number): CubicBezier {
  return {
    start: { x: b.start.x, y: b.start.y + dy },
    c1: { x: b.c1.x, y: b.c1.y + dy },
    c2: { x: b.c2.x, y: b.c2.y + dy },
    end: { x: b.end.x, y: b.end.y + dy },
  }
}

/**
 * Find the unique single-wire connection in `parentDef` whose bezier crosses the segment
 * (a, b). Returns the connection and crossing point, or null when the crossing is absent
 * or ambiguous (multiple wires/bus lanes, or a single wire crossed more than once).
 */
export function findWireAtLine(design: Design, parentDef: ComponentDef, a: Point, b: Point): WireHitResult | null {
  if (Math.hypot(b.x - a.x, b.y - a.y) < EPS) return null
  if (parentDef.kind !== 'composite') return null

  const hits: WireHitResult[] = []
  for (const conn of parentDef.connections ?? []) {
    const from = resolve(design, parentDef, conn.from)
    const to = resolve(design, parentDef, conn.to)
    if (!from || !to) continue
    const width = pinWidth(design, parentDef, conn.from)
    const base = wirePath(from.pos, to.pos, { fromJoin: from.join, toJoin: to.join })
    for (const dy of busWireOffsets(width)) {
      const curve = shiftY(base, dy)
      for (const point of curveIntersections(curve, a, b)) {
        const dup = hits.some((h) => h.connection.id === conn.id && Math.hypot(h.point.x - point.x, h.point.y - point.y) < DEDUP_EPS)
        if (!dup) hits.push({ connection: conn, point })
      }
    }
  }

  if (hits.length !== 1) return null
  const hit = hits[0]
  if (pinWidth(design, parentDef, hit.connection.from) !== 1) return null
  return hit
}

/** Half-extent (world units) of the `X` used to pick a wire when dropping a NODE. */
export const JOINPOINT_PICK_HALF = 16

/**
 * Find the single-wire connection under a dropped join-point, using two 45° diagonal
 * segments through `pos`. At least one diagonal always crosses a wire regardless of its
 * direction; if the two diagonals resolve to *different* connections the drop is
 * ambiguous and null is returned.
 */
export function findJoinpointWire(design: Design, parentDef: ComponentDef, pos: Point, half: number = JOINPOINT_PICK_HALF): WireHitResult | null {
  const d1 = findWireAtLine(design, parentDef, { x: pos.x - half, y: pos.y - half }, { x: pos.x + half, y: pos.y + half })
  const d2 = findWireAtLine(design, parentDef, { x: pos.x - half, y: pos.y + half }, { x: pos.x + half, y: pos.y - half })
  if (d1 && d2 && d1.connection.id !== d2.connection.id) return null
  return d1 ?? d2 ?? null
}
