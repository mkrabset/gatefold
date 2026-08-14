import type { ComponentDef, PrimitiveKind } from './types'

export interface PrimitiveSpec {
  kind: PrimitiveKind
  label: string
  inputs: number
  outputs: number
  glyph: string
}

export const PRIMITIVE_LIBRARY: PrimitiveSpec[] = [
  { kind: 'and', label: 'AND', inputs: 2, outputs: 1, glyph: '&' },
  { kind: 'or', label: 'OR', inputs: 2, outputs: 1, glyph: '≥1' },
  { kind: 'xor', label: 'XOR', inputs: 2, outputs: 1, glyph: '=1' },
  { kind: 'not', label: 'NOT', inputs: 1, outputs: 1, glyph: '1' },
  { kind: 'clock', label: 'CLOCK', inputs: 0, outputs: 1, glyph: '∿' },
]

export function primitiveDef(kind: PrimitiveKind): ComponentDef {
  const spec = PRIMITIVE_LIBRARY.find((p) => p.kind === kind)!
  return {
    id: `def-${kind}`,
    name: spec.label,
    kind: 'primitive',
    primitive: kind,
    inputs: spec.inputs,
    outputs: spec.outputs,
  }
}

export function specOf(kind: PrimitiveKind): PrimitiveSpec {
  return PRIMITIVE_LIBRARY.find((p) => p.kind === kind)!
}
