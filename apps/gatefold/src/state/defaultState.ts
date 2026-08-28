import type { Design } from '@gatefold/model'
import {
  newUuid,
  parseDesign,
  sanitizeDesign,
  serializeDesign,
  unreachableDefIds,
  withBuiltinPrimitives,
} from '@gatefold/model'

/**
 * Persistence of the "default" program state: the whole `Design` (model + composite
 * components) stored in `localStorage` so the app can initialize to it on launch.
 *
 * The design is stored exactly as `Save JSON` serializes it (`serializeDesign`), and
 * restored through the same parse/repair pipeline as loading a file, so a stored
 * default is always self-contained and consistent with the current built-ins.
 */

export const DEFAULT_STATE_KEY = 'gatefold-default-design'

/** True when `localStorage` is available (it is not in some test/SSR environments). */
function hasStorage(): boolean {
  return typeof localStorage !== 'undefined'
}

/**
 * Parse and repair a serialized design (add missing built-ins, drop dangling refs,
 * backfill lineage uuids, reclaim orphaned defs). Throws on malformed input.
 */
export function repairDesign(json: string): { design: Design; issues: ReturnType<typeof sanitizeDesign>['issues'] } {
  const design = parseDesign(json)
  const repaired = sanitizeDesign(withBuiltinPrimitives(design))
  for (const def of Object.values(repaired.design.defs)) {
    if (def.kind === 'composite' && !def.uuid) def.uuid = newUuid()
  }
  for (const id of unreachableDefIds(repaired.design)) delete repaired.design.defs[id]
  return repaired
}

/** The stored default design, or null when none is set / it cannot be restored. */
export function readDefaultState(): Design | null {
  if (!hasStorage()) return null
  let json: string | null
  try {
    json = localStorage.getItem(DEFAULT_STATE_KEY)
  } catch {
    return null
  }
  if (!json) return null
  try {
    return repairDesign(json).design
  } catch {
    return null
  }
}

/** Persist the current design as the default launch state. Returns false on failure. */
export function saveDefaultState(design: Design): boolean {
  if (!hasStorage()) return false
  try {
    localStorage.setItem(DEFAULT_STATE_KEY, serializeDesign(design))
    return true
  } catch {
    return false
  }
}

/** Remove any stored default state. Returns false on failure. */
export function clearDefaultState(): boolean {
  if (!hasStorage()) return false
  try {
    localStorage.removeItem(DEFAULT_STATE_KEY)
    return true
  } catch {
    return false
  }
}
