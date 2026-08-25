import type { PrimitiveKind } from '@gatefold/model'

export interface SimConfig {
  /** Default propagation delay for a gate, in picoseconds. */
  defaultDelay: number
  /** Per-primitive-kind delay override, in picoseconds. */
  perKindDelay: Partial<Record<PrimitiveKind, number>>
  /** Step semantics: settle to quiescence, or advance one clock edge. */
  stepMode: 'quiescent' | 'clock-edge'
}

export const DEFAULT_CONFIG: SimConfig = {
  defaultDelay: 100,
  perKindDelay: {},
  stepMode: 'quiescent',
}

export function delayOf(config: SimConfig, kind: PrimitiveKind): number {
  return config.perKindDelay[kind] ?? config.defaultDelay
}
