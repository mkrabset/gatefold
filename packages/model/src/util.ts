import type { ComponentDef, Design } from './types'

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

/** A flattened view of every def in the design (library + content tree). */
export function combinedDefs(design: Design): Record<string, ComponentDef> {
  return { ...design.library, ...design.defs }
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

/** Remap each instance's `defId` through `idMap` (unmapped ids are left unchanged). */
export function remapInstanceDefs(def: ComponentDef, idMap: ReadonlyMap<string, string>): void {
  if (def.kind !== 'composite') return
  for (const inst of def.instances ?? []) {
    const mapped = idMap.get(inst.defId)
    if (mapped) inst.defId = mapped
  }
}

/**
 * Collect `roots` plus their transitive composite def closure, skipping any def for
 * which `skip` returns true. Order follows depth-first discovery.
 */
export function collectClosure(
  defs: Record<string, ComponentDef>,
  roots: string[],
  skip: (def: ComponentDef) => boolean,
): Set<string> {
  const closure = new Set<string>()
  const visit = (defId: string) => {
    if (closure.has(defId)) return
    const def = defs[defId]
    if (!def || skip(def)) return
    closure.add(defId)
    if (def.kind === 'composite') {
      for (const inst of def.instances ?? []) visit(inst.defId)
    }
  }
  for (const id of roots) visit(id)
  return closure
}

/**
 * Ids of content-tree defs that are no longer reachable from the root. Only `defs`
 * (the content tree) is collected — the library is never GC'd. Canonical built-in
 * primitives (whose `id` equals their `primitive` kind) are always kept, even when
 * nothing references them, since they are regenerated on load.
 */
export function unreachableDefIds(design: Design): Set<string> {
  const defs = design.defs
  const reachable = collectClosure(defs, [design.root], () => false)
  const ids = new Set(Object.keys(defs))
  for (const id of reachable) ids.delete(id)
  for (const [id, def] of Object.entries(defs)) {
    if (def.kind === 'primitive' && def.id === def.primitive) ids.delete(id)
  }
  return ids
}
