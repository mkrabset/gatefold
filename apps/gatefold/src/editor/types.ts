import type { PinRef, Signal } from '@gatefold/model'

/**
 * Shared editor-layer types: the geometry and interaction shapes used by the canvas,
 * renderer, and stores. Kept free of store dependencies so the editor modules never
 * reach into state.
 */

/** The camera transform: the world point shown at the canvas centre, plus zoom. */
export interface Viewport {
  x: number
  y: number
  zoom: number
}

/** An axis-aligned rectangle in world space (e.g. a marquee selection). */
export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** A wire being drawn: anchored at `from`, with the cursor currently at (x, y). */
export interface PendingWire {
  from: PinRef
  x: number
  y: number
  /** When re-targeting an existing wire, its id (hidden from rendering while pending). */
  originalId?: string
}

/** An imaginary cut line (Ctrl/Cmd+drag) used to slice a wire with a new NODE. */
export interface CutLine {
  start: { x: number; y: number }
  end: { x: number; y: number }
}

/** Simulation view callbacks: resolve a signal color/value for a pin (and bus lane). */
export interface SimView {
  colorOf: (instanceId: string, portId: string, lane?: number) => string | undefined
  valueOf: (instanceId: string, portId: string) => Signal | undefined
  signalOf: (instanceId: string, portId: string) => Signal[] | undefined
  /** Formatted simulation-speed label shown as a HUD overlay. */
  speedLabel: string
}
