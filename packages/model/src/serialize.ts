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

/**
 * Remove dangling references from a design: connections whose endpoints reference
 * missing instances, and instances whose `defId` is not present in `defs`. Used on
 * load so a partially-inconsistent file can still be opened and edited without
 * crashing. Returns the repaired design plus details of what was removed.
 */
export interface SanitizeIssue {
  type: 'dangling-connection' | 'dangling-instance'
  defId: string
  connectionId?: string
  endpoint?: 'from' | 'to'
  missingInstanceId?: string
  instanceId?: string
  instanceName?: string
  missingDefId?: string
}

export function sanitizeDesign(design: Design): { design: Design; issues: SanitizeIssue[] } {
  const defs: Record<string, ComponentDef> = {}
  const issues: SanitizeIssue[] = []
  for (const [id, def] of Object.entries(design.defs)) {
    if (def.kind !== 'composite') {
      defs[id] = def
      continue
    }
    const instances = (def.instances ?? []).filter((i) => {
      if (design.defs[i.defId]) return true
      issues.push({ type: 'dangling-instance', defId: id, instanceId: i.id, instanceName: i.name, missingDefId: i.defId })
      return false
    })
    const instanceIds = new Set(instances.map((i) => i.id))
    const connections = (def.connections ?? []).filter((c) => {
      if (!instanceIds.has(c.from.instanceId)) {
        issues.push({ type: 'dangling-connection', defId: id, connectionId: c.id, endpoint: 'from', missingInstanceId: c.from.instanceId })
        return false
      }
      if (!instanceIds.has(c.to.instanceId)) {
        issues.push({ type: 'dangling-connection', defId: id, connectionId: c.id, endpoint: 'to', missingInstanceId: c.to.instanceId })
        return false
      }
      return true
    })
    defs[id] = { ...def, instances, connections }
  }
  return { design: { ...design, defs }, issues }
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
