import type { ComponentDef, Design, Instance } from './types'
import { cloneDef, cloneDesign } from './group'

/**
 * Copy/paste primitives. A clipboard is a self-contained snapshot: a set of
 * deep-copied component definitions plus the copied instances that reference them.
 * Because the app uses copy-on-place, pasting re-copies the whole transitive def
 * closure so each paste is fully independent of the originals.
 */

export interface Clipboard {
  defs: Record<string, ComponentDef>
  instances: Instance[]
}

function isPortGroupDef(def: ComponentDef): boolean {
  return def.primitive === 'input-port' || def.primitive === 'output-port'
}

function nextId(existing: Set<string>, base: string): string {
  if (!existing.has(base)) return base
  let i = 2
  while (existing.has(`${base}~${i}`)) i++
  return `${base}~${i}`
}

/**
 * Deep-copy a set of root defs and their transitive closure into fresh, unique defs.
 * The special port-group primitives are *not* copied (they stay shared). Returns the
 * copied defs keyed by their new ids, plus a map from old id to new id.
 */
export function copyDefSubgraph(
  defs: Record<string, ComponentDef>,
  rootIds: string[],
  usedIds: Set<string>,
): { defs: Record<string, ComponentDef>; idMap: Map<string, string> } {
  const closure = new Set<string>()
  const visit = (defId: string) => {
    if (closure.has(defId)) return
    const def = defs[defId]
    if (!def || isPortGroupDef(def)) return
    closure.add(defId)
    for (const inst of def.instances ?? []) {
      visit(inst.defId)
    }
  }
  for (const id of rootIds) visit(id)

  const idMap = new Map<string, string>()
  for (const oldId of closure) {
    const newId = nextId(usedIds, oldId)
    usedIds.add(newId)
    idMap.set(oldId, newId)
  }

  const result: Record<string, ComponentDef> = {}
  for (const oldId of closure) {
    const def = cloneDef(defs[oldId])
    def.id = idMap.get(oldId)!
    def.variant = true
    for (const inst of def.instances ?? []) {
      const mapped = idMap.get(inst.defId)
      if (mapped) inst.defId = mapped
    }
    result[def.id] = def
  }

  return { defs: result, idMap }
}

/** Snapshot the selected instances (and their def closure) into a clipboard. */
export function captureClipboard(design: Design, defId: string, instanceIds: string[]): Clipboard | null {
  const def = design.defs[defId]
  const selected = (def.instances ?? []).filter((i) => instanceIds.includes(i.id))
  if (selected.length === 0) return null

  const rootIds = selected.map((i) => i.defId)
  const { defs, idMap } = copyDefSubgraph(design.defs, rootIds, new Set())

  return {
    defs,
    instances: selected.map((inst) => ({
      ...inst,
      pos: { ...inst.pos },
      defId: idMap.get(inst.defId) ?? inst.defId,
    })),
  }
}

/**
 * Paste a clipboard into a definition, re-copying with fresh ids and offsetting the
 * positions. Returns a new design and the ids of the newly created instances.
 */
export function instantiateClipboard(
  design: Design,
  defId: string,
  clipboard: Clipboard,
  offset: { x: number; y: number },
): { design: Design; newIds: string[] } {
  const result = cloneDesign(design)
  const def = result.defs[defId]
  if (!def) return { design: result, newIds: [] }

  const rootIds = clipboard.instances.map((i) => i.defId)
  const { defs, idMap } = copyDefSubgraph(clipboard.defs, rootIds, new Set(Object.keys(result.defs)))
  for (const [id, d] of Object.entries(defs)) {
    result.defs[id] = d
  }

  if (!def.instances) def.instances = []
  const usedInstanceIds = new Set(def.instances.map((i) => i.id))
  const usedNames = new Set(def.instances.map((i) => i.name))
  const newIds: string[] = []
  for (const inst of clipboard.instances) {
    const id = nextId(usedInstanceIds, inst.id)
    usedInstanceIds.add(id)
    const name = nextId(usedNames, inst.name)
    usedNames.add(name)
    def.instances.push({
      id,
      name,
      defId: idMap.get(inst.defId) ?? inst.defId,
      pos: { x: inst.pos.x + offset.x, y: inst.pos.y + offset.y },
    })
    newIds.push(id)
  }

  return { design: result, newIds }
}
