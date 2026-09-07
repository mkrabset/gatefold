import type { CompositeDef, Design } from './types'

/** Pre-order walk of every composite in the nested subtree rooted at `root`. */
export function walkComposites(root: CompositeDef, visit: (def: CompositeDef) => void): void {
  visit(root)
  for (const inst of root.instances) {
    if (inst.def.kind === 'composite') walkComposites(inst.def, visit)
  }
}

/** The ids of every composite in the nested subtree rooted at `root` (inclusive). */
export function collectCompositeSubtree(root: CompositeDef): Set<string> {
  const ids = new Set<string>()
  walkComposites(root, (def) => ids.add(def.id))
  return ids
}

/** Every composite id in the design (the whole content tree plus the library). */
export function allCompositeIds(design: { root: CompositeDef; library: Record<string, CompositeDef> }): Set<string> {
  const ids = new Set<string>()
  walkComposites(design.root, (d) => ids.add(d.id))
  for (const def of Object.values(design.library)) walkComposites(def, (d) => ids.add(d.id))
  return ids
}

/** Find a composite by id across the content tree and the library. */
export function findComposite(design: { root: CompositeDef; library: Record<string, CompositeDef> }, id: string): CompositeDef | undefined {
  let found: CompositeDef | undefined
  walkComposites(design.root, (d) => {
    if (!found && d.id === id) found = d
  })
  if (found) return found
  for (const def of Object.values(design.library)) {
    walkComposites(def, (d) => {
      if (!found && d.id === id) found = d
    })
    if (found) return found
  }
  return undefined
}

/** Whether any other library entry references `defId` as an instance (i.e. it is embedded). */
function isEmbeddedInLibrary(design: Design, defId: string): boolean {
  for (const def of Object.values(design.library)) {
    if (def.id === defId) continue
    if (def.instances.some((i) => i.def.kind === 'composite' && i.def.id === defId)) return true
  }
  return false
}

/**
 * True for a reusable origin template: a composite in the library that is not an
 * embedded copy of another template (not referenced as an instance by any other
 * library entry). These are the components listed in the library panel.
 */
export function isTemplateDef(design: Design, def: CompositeDef): boolean {
  if (def.id === design.root.id) return false
  if (design.library[def.id] !== def) return false
  return !isEmbeddedInLibrary(design, def.id)
}

/**
 * The display names of the origin templates. Used for name-collision checks when naming
 * or renaming a template — only other templates collide; names on live copies, embedded
 * copies, and the root are ignored (names are display-only).
 */
export function templateNames(design: Design): Set<string> {
  const names = new Set<string>()
  for (const def of Object.values(design.library)) {
    if (isTemplateDef(design, def)) names.add(def.name)
  }
  return names
}

/** The category shown for a template with no explicit `category` assigned. */
export const UNCATEGORIZED = 'Uncategorized'

/** A template's library category, defaulting to `UNCATEGORIZED` when unset or blank. */
export function templateCategory(def: CompositeDef): string {
  return def.category?.trim() || UNCATEGORIZED
}

/** The distinct, sorted library categories across the origin templates. */
export function templateCategories(design: Design): string[] {
  const cats = new Set<string>()
  for (const def of Object.values(design.library)) {
    if (isTemplateDef(design, def)) cats.add(templateCategory(def))
  }
  return [...cats].sort()
}
