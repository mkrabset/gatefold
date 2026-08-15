import type { ComponentDef, Port, PortDirection, PrimitiveKind } from './types'
import { inputPortId, inputPorts, outputPortId } from './types'

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
  /** Whether the number of input terminals is fixed (not user-editable). */
  fixedInputs: boolean
  /** Whether the number of output terminals is fixed (not user-editable). */
  fixedOutputs: boolean
  /** Whether terminal names can be renamed by the user. */
  allowRenameTerminals: boolean
}

export const PRIMITIVE_LIBRARY: PrimitiveSpec[] = [
  { kind: 'and', label: 'AND', inputs: 2, outputs: 1, glyph: '&', fixedInputs: false, fixedOutputs: true, allowRenameTerminals: false },
  { kind: 'or', label: 'OR', inputs: 2, outputs: 1, glyph: '≥1', fixedInputs: false, fixedOutputs: true, allowRenameTerminals: false },
  { kind: 'xor', label: 'XOR', inputs: 2, outputs: 1, glyph: '=1', fixedInputs: false, fixedOutputs: true, allowRenameTerminals: false },
  { kind: 'not', label: 'NOT', inputs: 1, outputs: 1, glyph: '1', fixedInputs: true, fixedOutputs: true, allowRenameTerminals: false },
  { kind: 'clock', label: 'CLOCK', inputs: 0, outputs: 1, glyph: '∿', fixedInputs: true, fixedOutputs: true, allowRenameTerminals: false },
  { kind: 'fan-in', label: 'FAN-IN', inputs: 2, outputs: 1, glyph: '≫', fixedInputs: false, fixedOutputs: true, allowRenameTerminals: false },
  { kind: 'fan-out', label: 'FAN-OUT', inputs: 1, outputs: 2, glyph: '≪', fixedInputs: true, fixedOutputs: false, allowRenameTerminals: false },
]

const INPUT_NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

// Build the ordered port list for a primitive: inputs A/B/C…, then output(s). The
// fan-in/fan-out bus terminal's width is derived from the opposite side's arity.
function buildPorts(kind: PrimitiveKind, inputs: number, outputs: number): Port[] {
  const ports: Port[] = []
  if (kind === 'fan-out') {
    ports.push({ id: inputPortId(0), name: 'BUS', direction: 'input' })
    for (let i = 0; i < outputs; i++) {
      ports.push({ id: outputPortId(i), name: `Y${i + 1}`, direction: 'output' })
    }
    return ports
  }
  if (kind === 'fan-in') {
    for (let i = 0; i < inputs; i++) {
      ports.push({ id: inputPortId(i), name: INPUT_NAMES[i] ?? `in${i + 1}`, direction: 'input' })
    }
    ports.push({ id: outputPortId(0), name: 'BUS', direction: 'output' })
    return ports
  }
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

/**
 * Whether the arity of `def` in the given direction is fixed. Composites are always
 * editable; primitives read their spec (the internal port-group primitives are fixed).
 */
export function isArityFixed(def: ComponentDef, direction: PortDirection): boolean {
  if (def.kind === 'composite') return false
  if (!def.primitive || def.primitive === 'input-port' || def.primitive === 'output-port') return true
  const spec = specOf(def.primitive)
  return direction === 'input' ? spec.fixedInputs : spec.fixedOutputs
}

/** Whether the terminals of `def` can be renamed by the user. */
export function allowRenameTerminals(def: ComponentDef): boolean {
  if (def.kind === 'composite') return true
  if (!def.primitive || def.primitive === 'input-port' || def.primitive === 'output-port') return false
  return specOf(def.primitive).allowRenameTerminals
}

/**
 * The suggested name for a newly-added input terminal of a primitive (the next
 * letter after the existing inputs), or null for composites (they use `inN`).
 */
export function nextPrimitiveInputName(def: ComponentDef): string | null {
  if (def.kind !== 'primitive') return null
  return INPUT_NAMES[inputPorts(def).length] ?? null
}

/**
 * The special port primitives. Their pins are *derived* from the composite that
 * contains them (one `input-port` instance per composite carries all its inputs as
 * source pins; one `output-port` instance carries all its outputs as sink pins), so
 * the defs themselves have no ports. Their "external" side is cosmetic and
 * represented by the composite's own `ports` when used as an instance.
 */
export function inputPortDef(): ComponentDef {
  return {
    id: 'input-port',
    name: 'input-port',
    kind: 'primitive',
    primitive: 'input-port',
    ports: [],
  }
}

export function outputPortDef(): ComponentDef {
  return {
    id: 'output-port',
    name: 'output-port',
    kind: 'primitive',
    primitive: 'output-port',
    ports: [],
  }
}

/** The def for a port primitive of the given direction. */
export function portPrimitiveDef(direction: 'input' | 'output'): ComponentDef {
  return direction === 'input' ? inputPortDef() : outputPortDef()
}
