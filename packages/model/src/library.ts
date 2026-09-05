import type { ComponentDef, Design } from './types'
import { isTemplateDef } from './types'
import { cloneDef, cloneDesign } from './group'
import { buildProject, isComponentDef, isRecord, parseJson, stringifyJson } from './serialize'
import { collectClosure, newUuid, remapInstanceDefs, uniqueId } from './util'

/**
 * Export/import of the custom component library. A library file is the library part of
 * a saved project: it is produced by `buildProject` (the same code path as "Save JSON",
 * minus the content tree), so the library portion of the two files is byte-identical.
 */

export const LIBRARY_VERSION = 1

export interface LibraryFile {
  version: number
  library: Record<string, ComponentDef>
}

/** Produce the library file for a design (identical to the `library` field of Save JSON). */
export function exportLibrary(design: Design): LibraryFile {
  return { version: LIBRARY_VERSION, library: buildProject(design).library }
}

/** Serialize a library file to JSON. */
export function serializeLibrary(lib: LibraryFile): string {
  return stringifyJson(lib)
}

/** Parse and validate a library file, throwing on malformed input. */
export function parseLibrary(json: string): LibraryFile {
  return parseJson(json, isLibraryFile, 'Gatefold library')
}

function isLibraryFile(v: unknown): v is LibraryFile {
  if (!isRecord(v)) return false
  if (typeof v.version !== 'number') return false
  if (!isRecord(v.library)) return false
  return Object.values(v.library).every(isComponentDef)
}

/**
 * Merge a library into a design, returning a new design. Imported components get fresh,
 * unique ids (collision-free against the design and each other) and unique names, and
 * their internal references to other imported components are remapped accordingly.
 * Composite lineage (`uuid`) is remapped consistently so an imported template and its
 * embedded copies keep their shared soft link. Existing defs are never overwritten.
 */
export function importLibrary(design: Design, lib: LibraryFile): Design {
  const result = cloneDesign(design)

  const usedIds = new Set([...Object.keys(result.library), ...Object.keys(result.defs)])
  const idMap = new Map<string, string>()
  for (const c of Object.values(lib.library)) {
    const newId = uniqueId(usedIds, c.id, '~')
    usedIds.add(newId)
    idMap.set(c.id, newId)
  }

  const usedNames = new Set([...Object.values(result.library), ...Object.values(result.defs)].map((d) => d.name))
  const uuidMap = new Map<string, string>()
  for (const c of Object.values(lib.library)) {
    const def = cloneDef(c)
    def.id = idMap.get(c.id) ?? c.id
    if (def.kind === 'composite' && def.uuid) {
      let nu = uuidMap.get(def.uuid)
      if (!nu) {
        nu = newUuid()
        uuidMap.set(def.uuid, nu)
      }
      def.uuid = nu
    }
    def.name = uniqueId(usedNames, def.name || 'component', '~')
    usedNames.add(def.name)
    remapInstanceDefs(def, idMap)
    result.library[def.id] = def
  }

  return result
}

/**
 * The library def ids reachable from `templateId`'s instances — the template itself plus
 * its embedded parts (composite copies and primitive forks). Other origin templates are
 * excluded (defensive: a template never references an origin directly), and built-in
 * primitives are naturally excluded (they live in `defs`, not `library`).
 */
function templateClosure(design: Design, templateId: string): Set<string> {
  return collectClosure(
    design.library,
    [templateId],
    (def) => def.id !== templateId && isTemplateDef(design, def),
  )
}

/**
 * Remove a template and its embedded parts from the library, returning a new design.
 * The template's embedded parts are only reachable through it, so they are deleted
 * together with it (they would otherwise be orphaned and promoted to visible templates).
 * The `uuid` soft link on any remaining copy (a live copy in the content tree) is cleared,
 * so no dangling lineage reference remains. Origin templates referenced only as copies
 * are left untouched.
 */
export function deleteTemplate(design: Design, templateId: string): Design {
  const template = design.library[templateId]
  if (!template) return design
  const result = cloneDesign(design)
  for (const defId of templateClosure(result, templateId)) delete result.library[defId]
  if (template.kind === 'composite' && template.uuid) {
    for (const def of [...Object.values(result.library), ...Object.values(result.defs)]) {
      if (def.kind === 'composite' && def.id !== templateId && def.uuid === template.uuid) delete def.uuid
    }
  }
  return result
}
