import type { Viewport } from '../state/editorStore'

/**
 * World ↔ screen coordinate transforms. The canvas shows the world point `viewport.x/y`
 * at its center; `zoom` scales world units to screen pixels.
 */

/** World → screen: the screen-space point for a world point. */
export function w2s(wx: number, wy: number, w: number, h: number, vp: Viewport) {
  return {
    x: w / 2 + (wx - vp.x) * vp.zoom,
    y: h / 2 + (wy - vp.y) * vp.zoom,
  }
}

/** Screen → world: the world point for a screen-space point (relative to the canvas). */
export function s2w(sx: number, sy: number, w: number, h: number, vp: Viewport) {
  return {
    x: vp.x + (sx - w / 2) / vp.zoom,
    y: vp.y + (sy - h / 2) / vp.zoom,
  }
}
