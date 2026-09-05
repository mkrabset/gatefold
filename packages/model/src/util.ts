import type { CompositeDef } from './types'

/** Generate a fresh UUID for a template lineage (browser + node). */
export function newUuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    const v = ch === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** Produce an id/name unique against `existing`: `base`, then `base<sep>2`, `base<sep>3`… */
export function uniqueId(existing: Set<string>, base: string, sep = '-'): string {
  if (!existing.has(base)) return base
  let i = 2
  while (existing.has(`${base}${sep}${i}`)) i++
  return `${base}${sep}${i}`
}

/** Minimal path-compressing union-find over string keys. */
export class UnionFind {
  private parent = new Map<string, string>()

  find(x: string): string {
    const p = this.parent.get(x)
    if (p === undefined) {
      this.parent.set(x, x)
      return x
    }
    if (p !== x) this.parent.set(x, this.find(p))
    return this.parent.get(x)!
  }

  union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
}

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
