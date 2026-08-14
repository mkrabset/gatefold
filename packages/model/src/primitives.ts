import type { ComponentDef, Port, PrimitiveKind } from './types'
import { inputPortId, outputPortId } from './types'

/**
 * The built-in primitive components and their behavior metadata.
 *
 * Primitives have no `instances`/`connections` — their behavior is implicit in
 * their `PrimitiveKind` and evaluated directly by the simulator. `PrimitiveSpec`
 * is the display/arity info used by the library UI; `primitiveDef` turns it into a
 * full `ComponentDef`.
 */

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

const INPUT_NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

// Build the ordered port list for a primitive: inputs A/B/C…, then output(s).
function buildPorts(kind: PrimitiveKind, inputs: number, outputs: number): Port[] {
  const ports: Port[] = []
  for (let i = 0; i < inputs; i++) {
    ports.push({ id: inputPortId(i), name: INPUT_NAMES[i] ?? `in${i + 1}`, direction: 'input' })
  }
  for (let i = 0; i < outputs; i++) {
    ports.push({ id: outputPortId(i), name: kind === 'clock' ? 'CLK' : 'Y', direction: 'output' })
  }
  return ports
}

export function primitiveDef(kind: PrimitiveKind): ComponentDef {
  const spec = specOf(kind)
  return {
    id: kind,
    name: spec.label,
    kind: 'primitive',
    primitive: kind,
    ports: buildPorts(kind, spec.inputs, spec.outputs),
  }
}

export function specOf(kind: PrimitiveKind): PrimitiveSpec {
  return PRIMITIVE_LIBRARY.find((p) => p.kind === kind)!
}
