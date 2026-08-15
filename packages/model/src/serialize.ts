import type { ComponentDef, Design } from './types'

/**
 * Serialization of a whole design. A saved design is self-contained: the entire
 * `Design` (primitive defs, port-group defs, composites, and `variant` copies) is
 * serialized verbatim so a load restores the schematic exactly.
 */

export function serializeDesign(design: Design): string {
  return JSON.stringify(design, null, 2)
}

/** Parse and validate a serialized design, throwing on malformed input. */
export function parseDesign(json: string): Design {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    throw new Error('Not a valid JSON file')
  }
  if (!isDesign(data)) throw new Error('Not a valid Logica design')
  return data
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function isComponentDef(v: unknown): v is ComponentDef {
  if (!isRecord(v)) return false
  if (typeof v.id !== 'string') return false
  if (v.kind !== 'primitive' && v.kind !== 'composite') return false
  if (!Array.isArray(v.ports)) return false
  return true
}

function isDesign(v: unknown): v is Design {
  if (!isRecord(v)) return false
  if (typeof v.version !== 'number') return false
  const root = v.root
  if (typeof root !== 'string') return false
  const defs = v.defs
  if (!isRecord(defs)) return false
  for (const def of Object.values(defs)) {
    if (!isComponentDef(def)) return false
  }
  if (!(root in defs)) return false
  return true
}
