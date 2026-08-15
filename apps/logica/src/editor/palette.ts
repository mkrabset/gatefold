/**
 * Color palettes for the canvas renderer. The DOM UI is themed separately via CSS
 * variables; these constants cover only what is drawn on the `<canvas>`. The renderer
 * receives the active palette as a parameter so it stays independent of the theme store.
 */

export interface Palette {
  bg: string
  grid: string
  wire: string
  gateStroke: string
  gateFill: string
  compositeFill: string
  pin: string
  pinHover: string
  portHover: string
  grabHover: string
  selection: string
  text: string
}

export const darkPalette: Palette = {
  bg: '#0d1117',
  grid: '#1a212b',
  wire: '#8b98a5',
  gateStroke: '#e6edf3',
  gateFill: '#1c2129',
  compositeFill: '#18202c',
  pin: '#4f8cff',
  pinHover: '#6ee7b7',
  portHover: '#fbbf24',
  grabHover: '#fb923c',
  selection: '#4f8cff',
  text: '#c9d1d9',
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
  portHover: '#b45309',
  grabHover: '#c2410c',
  selection: '#2563eb',
  text: '#1f2328',
}
