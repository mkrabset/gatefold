export interface Palette {
  bg: string
  grid: string
  wire: string
  gateStroke: string
  gateFill: string
  compositeFill: string
  pin: string
  pinHover: string
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
  selection: '#2563eb',
  text: '#1f2328',
}
