import type { ComponentDef } from './types'

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

/** Remap each instance's `defId` through `idMap` (unmapped ids are left unchanged). */
export function remapInstanceDefs(def: ComponentDef, idMap: ReadonlyMap<string, string>): void {
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
    for (const inst of def.instances ?? []) visit(inst.defId)
  }
  for (const id of roots) visit(id)
  return closure
}
