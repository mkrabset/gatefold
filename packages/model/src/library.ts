import type { CompositeDef, Design } from './types'
import { templateNames } from './types'
import { cloneComposite, cloneDesign } from './group'
import { buildProject, isComposite, isRecord, parseJson, stringifyJson } from './serialize'
import { allCompositeIds, newUuid, uniqueId, walkComposites } from './util'

/**
 * Export/import of the custom component library. A library file is the library part of
 * a saved project: it is produced by `buildProject` (the same code path as "Save JSON",
 * minus the content tree), so the library portion of the two files is byte-identical.
 */

export const LIBRARY_VERSION = 1

export interface LibraryFile {
  version: number
  library: Record<string, CompositeDef>
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
  return Object.values(v.library).every(isComposite)
}

/** Rewrite every composite `uuid` in `root` through `uuidMap`, assigning a fresh uuid to
 *  each distinct lineage so an imported template and its embedded copies keep their
 *  shared soft link (while not colliding with the target design's lineages). */
function remapUuids(root: CompositeDef, uuidMap: Map<string, string>): void {
  walkComposites(root, (def) => {
    if (!def.uuid) return
    let nu = uuidMap.get(def.uuid)
    if (!nu) {
      nu = newUuid()
      uuidMap.set(def.uuid, nu)
    }
    def.uuid = nu
  })
}

/**
 * Merge a library into a design, returning a new design. Each imported origin template
 * is deep-cloned with fresh, collision-free ids and a unique name; its internal
 * references (inline children) come along by ownership, and composite lineage (`uuid`)
 * is remapped consistently. Existing templates are never overwritten.
 */
export function importLibrary(design: Design, lib: LibraryFile): Design {
  const result = cloneDesign(design)
  const usedIds = allCompositeIds(result)
  const usedNames = new Set(templateNames(result))
  const uuidMap = new Map<string, string>()
  for (const entry of Object.values(lib.library)) {
    const copy = cloneComposite(entry, usedIds)
    remapUuids(copy, uuidMap)
    copy.name = uniqueId(usedNames, copy.name || 'component', '~')
    usedNames.add(copy.name)
    result.library[copy.id] = copy
  }
  return result
}

/**
 * Remove a template from the library, returning a new design. Its embedded parts are
 * owned inline, so they are deleted together with it (no reachability bookkeeping).
 * The `uuid` soft link on any remaining copy (a live copy in the content tree, or an
 * embedded copy inside another template) is cleared, so no dangling lineage reference
 * remains.
 */
export function deleteTemplate(design: Design, templateId: string): Design {
  const template = design.library[templateId]
  if (!template) return design
  const result = cloneDesign(design)
  delete result.library[templateId]
  if (template.uuid) {
    const clear = (def: CompositeDef): void => {
      if (def.id !== templateId && def.uuid === template.uuid) delete def.uuid
    }
    walkComposites(result.root, clear)
    for (const def of Object.values(result.library)) walkComposites(def, clear)
  }
  return result
}
