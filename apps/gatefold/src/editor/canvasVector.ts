import type { VectorContext } from '@gatefold/model'

/**
 * Adapts a `CanvasRenderingContext2D` to the model's DOM-free `VectorContext`, so
 * primitives can draw themselves without depending on the canvas API.
 */
export function canvasVectorContext(ctx: CanvasRenderingContext2D): VectorContext {
  return {
    beginPath: () => ctx.beginPath(),
    moveTo: (x, y) => ctx.moveTo(x, y),
    lineTo: (x, y) => ctx.lineTo(x, y),
    quadraticCurveTo: (cpx, cpy, x, y) => ctx.quadraticCurveTo(cpx, cpy, x, y),
    ellipse: (cx, cy, rx, ry, rotation, start, end, counterclockwise) =>
      ctx.ellipse(cx, cy, rx, ry, rotation, start, end, counterclockwise),
    arc: (x, y, r, start, end, counterclockwise) => ctx.arc(x, y, r, start, end, counterclockwise),
    roundRect: (x, y, w, h, r) => ctx.roundRect(x, y, w, h, r),
    closePath: () => ctx.closePath(),
    fill: (style) => {
      ctx.fillStyle = style
      ctx.fill()
    },
    stroke: (style, lineWidth) => {
      ctx.strokeStyle = style
      if (lineWidth !== undefined) ctx.lineWidth = lineWidth
      ctx.stroke()
    },
  }
}
