/**
 * Number formatting for on-canvas overlays: rounded to at most 3 decimals with trailing
 * zeros stripped.
 */

const trim3 = (n: number): string => String(Number(n.toFixed(3)))

/** Format a frequency in hertz as Hz / kHz / MHz (max 3 decimals, no trailing zeros). */
export function formatFrequency(hz: number): string {
  if (hz < 1000) return `${trim3(hz)} Hz`
  if (hz < 1_000_000) return `${trim3(hz / 1e3)} kHz`
  return `${trim3(hz / 1e6)} MHz`
}

/** Describe a simulation speed factor relative to real time. */
export function formatSpeed(timeScale: number): string {
  if (timeScale > 1) return `${trim3(timeScale)}x faster`
  if (timeScale < 1) return `${trim3(1 / timeScale)}x slower`
  return 'real-time'
}
