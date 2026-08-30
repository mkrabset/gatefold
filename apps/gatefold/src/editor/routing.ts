/**
 * Wire routing. Kept isolated so alternative routers (orthogonal, buses) can be
 * swapped in without touching the renderer. Everything is in world space.
 */

export interface Point {
  x: number
  y: number
}

export interface CubicBezier {
  start: Point
  c1: Point
  c2: Point
  end: Point
}

export interface WirePathOptions {
  /** `a` is a join-point (collapse the first control point onto it). */
  fromJoin?: boolean
  /** `b` is a join-point (collapse the last control point onto it). */
  toJoin?: boolean
}

/**
 * Route a wire from an output terminal `a` to an input terminal `b`.
 *
 * Wires always leave the source on its right side and enter the target on its
 * left side, so we give the curve horizontal tangents at both ends. The
 * control-point horizontal offset is one half of the absolute horizontal
 * distance between the terminals.
 *
 * When an endpoint is a join-point (a dot with coincident terminals), its nearest
 * control point is collapsed onto the endpoint so the wire radiates straight from
 * (or into) the dot rather than leaving with a horizontal tangent.
 */
export function wirePath(a: Point, b: Point, opts: WirePathOptions = {}): CubicBezier {
  const off = Math.abs(b.x - a.x) / 2
  return {
    start: { x: a.x, y: a.y },
    c1: opts.fromJoin ? { x: a.x, y: a.y } : { x: a.x + off, y: a.y },
    c2: opts.toJoin ? { x: b.x, y: b.y } : { x: b.x - off, y: b.y },
    end: { x: b.x, y: b.y },
  }
}
