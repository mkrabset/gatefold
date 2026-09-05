import type { ComponentDef, Design } from './types'
import { getDef } from './types'
import { collectClosure, unreachableDefIds } from './util'

/**
 * Serialization of a whole design. The output is compact, not verbatim:
 * - canonical built-in primitive defs are omitted (regenerated on load via
 *   `withBuiltinPrimitives`);
 * - unreferenced content-tree defs are dropped (the same reachability GC the loader runs);
 * - instance `pos` coordinates are rounded to 2 decimals (sub-pixel, visually lossless).
 * A load restores the schematic exactly.
 */

/** The serialized project: the content tree (`root` + `defs`) plus the library. */
export interface ProjectJson {
  version: number
  root: string
  library: Record<string, ComponentDef>
  defs: Record<string, ComponentDef>
}

/**
 * Remove the canonical built-in primitive defs — those whose `id` equals their
 * `primitive` kind (`primitiveDef(kind)` sets `id: kind`) — from the content tree.
 * The library never contains built-ins, so it is left untouched.
 */
export function stripBuiltinPrimitives(design: Design): Design {
  const defs: Record<string, ComponentDef> = {}
  for (const [id, def] of Object.entries(design.defs)) {
    if (def.kind === 'primitive' && def.id === def.primitive) continue
    defs[id] = def
  }
  return { ...design, defs }
}

/** Round instance coordinates to 2 decimals, shrinking the serialized output. */
function roundReplacer(key: string, value: unknown): unknown {
  if ((key === 'x' || key === 'y') && typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value * 100) / 100
  }
  return value
}

/** Serialize a value to compact JSON: 2-space indent, `x`/`y` coordinates rounded. */
export function stringifyJson(value: unknown): string {
  return JSON.stringify(value, roundReplacer, 2)
}

/**
 * Build the project JSON for a design. This is the single source of truth for the
 * serialized document: `serializeDesign` stringifies it, and `exportLibrary` reuses its
 * `library` field (so the library portion of a saved project and an exported library are
 * byte-identical). The library is emitted as-is (already normalized in memory) with keys
 * sorted for deterministic output.
 */
export function buildProject(design: Design): ProjectJson {
  const stripped = stripBuiltinPrimitives(design)
  const defs: Record<string, ComponentDef> = { ...stripped.defs }
  for (const id of unreachableDefIds(stripped)) delete defs[id]
  const library: Record<string, ComponentDef> = {}
  for (const id of Object.keys(design.library).sort()) library[id] = design.library[id]
  return { version: stripped.version, root: stripped.root, library, defs }
}

/** Serialize a design to compact JSON (built-ins stripped, orphans GC'd, coords rounded). */
export function serializeDesign(design: Design): string {
  return stringifyJson(buildProject(design))
}

/**
 * Parse and validate JSON, throwing a uniform error on malformed input or a value that
 * fails `validate`. Shared by the design and library loaders (the only difference is the
 * validator and the label in the validation error).
 */
export function parseJson<T>(json: string, validate: (v: unknown) => v is T, label: string): T {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    throw new Error('Not a valid JSON file')
  }
  if (!validate(data)) throw new Error(`Not a valid ${label}`)
  return data
}

/** Parse and validate a serialized design, migrating legacy files and throwing on malformed input. */
export function parseDesign(json: string): Design {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    throw new Error('Not a valid JSON file')
  }
  const design = migrateDesign(data)
  if (!isDesign(design)) throw new Error('Not a valid Gatefold design')
  return design
}

/**
 * Migrate a parsed document to the current shape. Files already carrying a `library` map
 * (current format) pass through; legacy files (a flat `defs` map with `variant` flags) are
 * split into `library` (templates + embedded copies) and `defs` (root + live copies +
 * built-ins), dropping the `variant` flag.
 */
function migrateDesign(v: unknown): unknown {
  if (!isRecord(v)) return v
  if (isRecord(v.library) && isRecord(v.defs) && typeof v.root === 'string') return v
  if (!isRecord(v.defs) || typeof v.root !== 'string') return v
  return migrateLegacyDesign(v)
}

/** Split a legacy flat `defs` (with `variant`) into `library` + `defs`. */
function migrateLegacyDesign(v: Record<string, unknown>): unknown {
  const legacy = v.defs as Record<string, ComponentDef & { variant?: boolean }>
  const root = v.root as string
  // Live defs = everything reachable from the root (following instance refs).
  const live = collectClosure(legacy, [root], () => false)
  const strip = (def: ComponentDef): ComponentDef => {
    const copy: ComponentDef & { variant?: boolean } = { ...def }
    delete copy.variant
    return copy
  }
  const library: Record<string, ComponentDef> = {}
  const defs: Record<string, ComponentDef> = {}
  for (const [id, def] of Object.entries(legacy)) {
    if (def.kind === 'primitive' && def.id === def.primitive) {
      defs[id] = strip(def)
    } else if (id === root) {
      defs[id] = strip(def)
    } else if (def.kind === 'composite' && def.variant !== true) {
      library[id] = strip(def)
    } else if (live.has(id)) {
      defs[id] = strip(def)
    } else {
      library[id] = strip(def)
    }
  }
  return { version: v.version, root, library, defs }
}

/**
 * Remove dangling references from a design: connections whose endpoints reference
 * missing instances, and instances whose `defId` is not present anywhere (library or
 * content tree). Used on load so a partially-inconsistent file can still be opened and
 * edited without crashing. Returns the repaired design plus details of what was removed.
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
  const issues: SanitizeIssue[] = []
  const sanitize = (map: Record<string, ComponentDef>): Record<string, ComponentDef> => {
    const out: Record<string, ComponentDef> = {}
    for (const [id, def] of Object.entries(map)) {
      if (def.kind !== 'composite') {
        out[id] = def
        continue
      }
      const instances = (def.instances ?? []).filter((i) => {
        if (getDef(design, i.defId)) return true
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
      out[id] = { ...def, instances, connections }
    }
    return out
  }
  const library = sanitize(design.library)
  const defs = sanitize(design.defs)
  return { design: { ...design, library, defs }, issues }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function isComponentDef(v: unknown): v is ComponentDef {
  if (!isRecord(v)) return false
  if (typeof v.id !== 'string') return false
  if (v.kind !== 'primitive' && v.kind !== 'composite') return false
  if (!Array.isArray(v.ports)) return false
  // A primitive def must name its primitive kind (the discriminated-union guarantee).
  if (v.kind === 'primitive' && typeof v.primitive !== 'string') return false
  return true
}

function isDesign(v: unknown): v is Design {
  if (!isRecord(v)) return false
  if (typeof v.version !== 'number') return false
  const root = v.root
  if (typeof root !== 'string') return false
  const library = v.library
  const defs = v.defs
  if (!isRecord(library) || !isRecord(defs)) return false
  for (const def of [...Object.values(library), ...Object.values(defs)]) {
    if (!isComponentDef(def)) return false
  }
  if (!(root in defs)) return false
  return true
}
