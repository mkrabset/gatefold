import type { ChildDef, CompositeDef, Connection, Design, Instance, PinRef, Port, PrimitiveKind } from './types'

/**
 * Serialization of a whole design. The output is the nested model verbatim (built-ins
 * are inline references, never stored as defs) with `pos` coordinates rounded to 2
 * decimals (sub-pixel, visually lossless). A load restores the schematic exactly.
 */

/** The serialized project: the nested content tree (`root`) plus the library. */
export interface ProjectJson {
  version: number
  root: CompositeDef
  library: Record<string, CompositeDef>
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
 * byte-identical). Library keys are sorted for deterministic output.
 */
export function buildProject(design: Design): ProjectJson {
  const library: Record<string, CompositeDef> = {}
  for (const id of Object.keys(design.library).sort()) library[id] = design.library[id]
  return { version: design.version, root: design.root, library }
}

/** Serialize a design to compact JSON (coords rounded, library keys sorted). */
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

// --- legacy (flat) model, used only during migration ----------------------------

interface LegacyPort {
  id: string
  name: string
  direction: 'input' | 'output'
  terminal?: { instanceId: string; pinId: string }
  inverted?: boolean
}
interface LegacyInstance {
  id: string
  name: string
  defId: string
  pos: { x: number; y: number }
  props?: Record<string, unknown>
}
interface LegacyDef {
  id: string
  name: string
  kind: 'primitive' | 'composite'
  primitive?: string
  ports: LegacyPort[]
  instances?: LegacyInstance[]
  connections?: Connection[]
  uuid?: string
  category?: string
  variant?: boolean
}

/**
 * Migrate a parsed document to the current (nested) shape. A document whose `root` is
 * already an object (the nested format) passes through; a flat document (a string `root`
 * id) is converted to nested — first splitting a legacy flat-`defs` file into the
 * two-part shape, then inlining every instance's def.
 */
function migrateDesign(v: unknown): unknown {
  if (!isRecord(v)) return v
  if (isRecord(v.root)) return v // already nested
  if (typeof v.root !== 'string') return v
  const flat = isRecord(v.library) && isRecord(v.defs) ? v : migrateLegacyDesign(v)
  if (!isRecord(flat) || !isRecord(flat.defs) || !isRecord(flat.library)) return flat
  return flatToNested({
    root: flat.root as string,
    library: flat.library as Record<string, LegacyDef>,
    defs: flat.defs as Record<string, LegacyDef>,
  })
}

/** Split a legacy flat `defs` (with `variant`) into `library` + `defs`. */
function migrateLegacyDesign(v: Record<string, unknown>): unknown {
  const legacy = v.defs as Record<string, LegacyDef>
  const root = v.root as string
  const live = collectLegacyClosure(legacy, root)
  const strip = (def: LegacyDef): LegacyDef => {
    const copy = { ...def }
    delete copy.variant
    return copy
  }
  const library: Record<string, LegacyDef> = {}
  const defs: Record<string, LegacyDef> = {}
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

function collectLegacyClosure(defs: Record<string, LegacyDef>, root: string): Set<string> {
  const closure = new Set<string>()
  const visit = (id: string): void => {
    if (closure.has(id)) return
    const def = defs[id]
    if (!def) return
    closure.add(id)
    if (def.kind === 'composite') {
      for (const inst of def.instances ?? []) visit(inst.defId)
    }
  }
  visit(root)
  return closure
}

/** Convert a two-part flat document into the nested model, inlining each instance's def. */
function flatToNested(flat: {
  root: string
  library: Record<string, LegacyDef>
  defs: Record<string, LegacyDef>
}): unknown {
  const all: Record<string, LegacyDef> = { ...flat.defs, ...flat.library }

  // Origin templates = library composites not referenced by any other library entry.
  const originIds = new Set<string>()
  for (const [id, def] of Object.entries(flat.library)) {
    if (def.kind !== 'composite') continue
    const referenced = Object.values(flat.library).some(
      (other) => other.kind === 'composite' && other.id !== id && (other.instances ?? []).some((i) => i.defId === id),
    )
    if (!referenced) originIds.add(id)
  }

  const defToNested = (defId: string): ChildDef | undefined => {
    const def = all[defId]
    if (!def) return undefined
    if (def.kind === 'primitive') {
      const primitive = def.primitive as PrimitiveKind
      if (def.id === def.primitive) return { kind: 'builtin', primitive }
      return { kind: 'fork', primitive, ports: def.ports as Port[] }
    }
    return {
      kind: 'composite',
      id: def.id,
      name: def.name,
      ...(def.uuid ? { uuid: def.uuid } : {}),
      ...(def.category ? { category: def.category } : {}),
      ports: def.ports as Port[],
      instances: (def.instances ?? []).flatMap((i) => {
        const child = defToNested(i.defId)
        if (!child) return []
        return [
          {
            id: i.id,
            name: i.name,
            pos: i.pos,
            ...(i.props ? { props: i.props as Instance['props'] } : {}),
            def: child,
          },
        ]
      }),
      connections: def.connections ?? [],
    }
  }

  const root = defToNested(flat.root)
  const library: Record<string, ChildDef> = {}
  for (const id of originIds) {
    const nested = defToNested(id)
    if (nested) library[id] = nested
  }
  return { version: 2, root, library }
}

// --- validation ----------------------------------------------------------------

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isPinRef(v: unknown): v is PinRef {
  return isRecord(v) && typeof v.instanceId === 'string' && typeof v.portId === 'string'
}

function isPort(v: unknown): v is Port {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    (v.direction === 'input' || v.direction === 'output')
  )
}

function isConnection(v: unknown): v is Connection {
  return isRecord(v) && typeof v.id === 'string' && isPinRef(v.from) && isPinRef(v.to)
}

function isInstance(v: unknown): v is Instance {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    isChildDef(v.def) &&
    isRecord(v.pos) &&
    typeof v.pos.x === 'number' &&
    typeof v.pos.y === 'number'
  )
}

/** A composite is always nested: its instances carry inline `ChildDef`s. */
export function isComposite(v: unknown): v is CompositeDef {
  return (
    isRecord(v) &&
    v.kind === 'composite' &&
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    Array.isArray(v.ports) &&
    v.ports.every(isPort) &&
    Array.isArray(v.instances) &&
    v.instances.every(isInstance) &&
    Array.isArray(v.connections) &&
    v.connections.every(isConnection)
  )
}

function isChildDef(v: unknown): v is ChildDef {
  if (!isRecord(v)) return false
  if (v.kind === 'builtin' || v.kind === 'fork') return typeof v.primitive === 'string'
  if (v.kind === 'composite') return isComposite(v)
  return false
}

function isDesign(v: unknown): v is Design {
  if (!isRecord(v)) return false
  if (typeof v.version !== 'number') return false
  if (!isComposite(v.root)) return false
  if (!isRecord(v.library)) return false
  return Object.values(v.library).every(isComposite)
}

// --- sanitization --------------------------------------------------------------

export interface SanitizeIssue {
  type: 'dangling-connection'
  defId: string
  connectionId?: string
  endpoint?: 'from' | 'to'
  missingInstanceId?: string
}

/**
 * Remove dangling connections (endpoints referencing a missing instance) from a design.
 * Returns the repaired design plus details of what was removed. A dangling instance is
 * structurally impossible in the nested model (an instance owns its def inline).
 */
export function sanitizeDesign(design: Design): { design: Design; issues: SanitizeIssue[] } {
  const issues: SanitizeIssue[] = []
  const sanitize = (def: CompositeDef): CompositeDef => {
    const instanceIds = new Set(def.instances.map((i) => i.id))
    const connections = def.connections.filter((c) => {
      if (!instanceIds.has(c.from.instanceId)) {
        issues.push({ type: 'dangling-connection', defId: def.id, connectionId: c.id, endpoint: 'from', missingInstanceId: c.from.instanceId })
        return false
      }
      if (!instanceIds.has(c.to.instanceId)) {
        issues.push({ type: 'dangling-connection', defId: def.id, connectionId: c.id, endpoint: 'to', missingInstanceId: c.to.instanceId })
        return false
      }
      return true
    })
    const instances = def.instances.map((i) => {
      if (i.def.kind === 'composite') return { ...i, def: sanitize(i.def) }
      // Normalize the join-point to its canonical shared builtin representation (a
      // fork join-point is behaviourally identical but carries a redundant ports array).
      if (i.def.kind === 'fork' && i.def.primitive === 'join-point') {
        return { ...i, def: { kind: 'builtin', primitive: 'join-point' } as const }
      }
      return i
    })
    return { ...def, instances, connections }
  }
  const root = sanitize(design.root)
  const library: Record<string, CompositeDef> = {}
  for (const [id, def] of Object.entries(design.library)) library[id] = sanitize(def)
  return { design: { ...design, root, library }, issues }
}
