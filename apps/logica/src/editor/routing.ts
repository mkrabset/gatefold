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

/**
 * Route a wire from an output terminal `a` to an input terminal `b`.
 *
 * Wires always leave the source on its right side and enter the target on its
 * left side, so we give the curve horizontal tangents at both ends. The
 * control-point horizontal offset is one half of the absolute horizontal
 * distance between the terminals.
 */
export function wirePath(a: Point, b: Point): CubicBezier {
  const off = Math.abs(b.x - a.x) / 2
  return {
    start: { x: a.x, y: a.y },
    c1: { x: a.x + off, y: a.y },
    c2: { x: b.x - off, y: b.y },
    end: { x: b.x, y: b.y },
  }
}
