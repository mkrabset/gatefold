import type { Palette } from '@gatefold/model'

/**
 * Color palettes for the canvas renderer. The DOM UI is themed separately via CSS
 * variables; these constants cover only what is drawn on the `<canvas>`. The renderer
 * receives the active palette as a parameter so it stays independent of the theme store.
 */

export const darkPalette: Palette = {
  bg: '#0d1117',
  grid: '#1a212b',
  wire: '#8b98a5',
  gateStroke: '#e6edf3',
  gateFill: '#1c2129',
  compositeFill: '#18202c',
  pin: '#4f8cff',
  pinHover: '#6ee7b7',
  pinHighlight: '#ef4444',
  selection: '#4f8cff',
  text: '#c9d1d9',
  templateBg: '#12253a',
  simBg: '#0a1f14',
}

export const lightPalette: Palette = {
  bg: '#ffffff',
  grid: '#e4e7ec',
  wire: '#59616c',
  gateStroke: '#1f2328',
  gateFill: '#ffffff',
  compositeFill: '#f4f6f8',
  pin: '#2563eb',
  pinHover: '#059669',
  pinHighlight: '#dc2626',
  selection: '#2563eb',
  text: '#1f2328',
  templateBg: '#e7f2fd',
  simBg: '#0d2418',
}
