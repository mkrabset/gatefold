import type { ComponentDef, Design } from './types'
import { cloneDef, cloneDesign } from './group'
import { isComponentDef, isRecord } from './serialize'
import { newUuid, remapInstanceDefs, uniqueId } from './util'

/**
 * Export/import of the custom component library. A library file is the set of
 * template composites (plus their transitive closure of composite defs), with all
 * references to built-in primitives normalized so the file is self-contained against
 * the target's primitive library.
 */

export const LIBRARY_VERSION = 1

export interface LibraryFile {
  version: number
  components: ComponentDef[]
}

const isPrimitiveDef = (def: ComponentDef | undefined): boolean => !!def && def.kind === 'primitive'

/**
 * Collect the library's template composites (and their composite def closure) for export,
 * deep-cloned with `variant` stripped. References to a template's variant copies are collapsed
 * back to the template itself via the shared lineage `uuid`, so only the library templates are
 * exported — never the instance-local copies. Instance references to primitive defs (including
 * `variant` primitive copies) are normalized to their built-in id so imports always resolve.
 */
export function exportLibrary(design: Design): LibraryFile {
  const templates = Object.values(design.defs).filter(
    (d) => d.kind === 'composite' && d.id !== design.root && d.variant !== true,
  )

  // Map each template's lineage uuid to its id, so a variant copy can be collapsed back to
  // the template it was copied from.
  const uuidToTemplate = new Map<string, string>()
  for (const t of templates) if (t.uuid) uuidToTemplate.set(t.uuid, t.id)

  /** The library template a composite def belongs to, or null (primitive / unresolved). */
  const templateIdOf = (defId: string): string | null => {
    const ref = design.defs[defId]
    if (!ref || ref.kind !== 'composite') return null
    if (ref.variant !== true) return ref.id
    return (ref.uuid && uuidToTemplate.get(ref.uuid)) ?? null
  }

  // Walk the templates' instance graph, collapsing variants to their templates. A variant
  // with no matching template is promoted (exported with `variant` stripped) so the file
  // stays self-contained rather than carrying a dangling reference.
  const exportIds = new Set<string>()
  const visit = (defId: string): void => {
    if (exportIds.has(defId)) return
    const def = design.defs[defId]
    if (!def || def.kind !== 'composite') return
    exportIds.add(defId)
    for (const inst of def.instances ?? []) {
      const ref = design.defs[inst.defId]
      if (!ref) continue
      if (ref.kind === 'primitive') continue
      const tid = templateIdOf(ref.id)
      visit(tid ?? ref.id)
    }
  }
  for (const t of templates) visit(t.id)

  const components: ComponentDef[] = []
  for (const id of exportIds) {
    const def = cloneDef(design.defs[id])
    delete def.variant
    for (const inst of def.instances ?? []) {
      const ref = design.defs[inst.defId]
      if (!ref) continue
      if (isPrimitiveDef(ref) && ref.primitive) {
        inst.defId = ref.primitive
      } else if (ref.kind === 'composite') {
        const tid = templateIdOf(ref.id)
        if (tid !== null) inst.defId = tid
      }
    }
    components.push(def)
  }

  return { version: LIBRARY_VERSION, components }
}

/** Serialize a library file to JSON. */
export function serializeLibrary(lib: LibraryFile): string {
  return JSON.stringify(lib, null, 2)
}

/** Parse and validate a library file, throwing on malformed input. */
export function parseLibrary(json: string): LibraryFile {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    throw new Error('Not a valid JSON file')
  }
  if (!isLibraryFile(data)) throw new Error('Not a valid Gatefold library')
  return data
}

function isLibraryFile(v: unknown): v is LibraryFile {
  if (!isRecord(v)) return false
  if (typeof v.version !== 'number') return false
  if (!Array.isArray(v.components)) return false
  return v.components.every(isComponentDef)
}

/**
 * Merge a library into a design, returning a new design. Imported components get fresh,
 * unique ids (collision-free against the design and each other) and unique names, and
 * their internal references to other imported components are remapped accordingly.
 * Existing defs are never overwritten.
 */
export function importLibrary(design: Design, lib: LibraryFile): Design {
  const result = cloneDesign(design)

  const usedIds = new Set(Object.keys(result.defs))
  const idMap = new Map<string, string>()
  for (const c of lib.components) {
    const newId = uniqueId(usedIds, c.id, '~')
    usedIds.add(newId)
    idMap.set(c.id, newId)
  }

  const usedNames = new Set(Object.values(result.defs).map((d) => d.name))
  for (const c of lib.components) {
    const def = cloneDef(c)
    def.id = idMap.get(c.id) ?? c.id
    delete def.variant
    def.uuid = newUuid()
    def.name = uniqueId(usedNames, def.name || 'component', '~')
    usedNames.add(def.name)
    remapInstanceDefs(def, idMap)
    result.defs[def.id] = def
  }

  return result
}
