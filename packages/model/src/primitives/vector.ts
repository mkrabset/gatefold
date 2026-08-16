/**
 * A DOM-free drawing context — the seam between primitive rendering and the host
 * canvas. Primitives draw themselves through this interface; the app supplies a
 * canvas-backed implementation, keeping the model framework-free and unit-testable.
 */
export interface VectorContext {
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void
  ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    rotation: number,
    start: number,
    end: number,
    counterclockwise?: boolean,
  ): void
  arc(x: number, y: number, r: number, start: number, end: number, counterclockwise?: boolean): void
  roundRect(x: number, y: number, w: number, h: number, r: number): void
  closePath(): void
  fill(style: string): void
  stroke(style: string, lineWidth?: number): void
}
