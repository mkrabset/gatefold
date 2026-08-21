import type { ComponentDef, Design, PinRef, Port } from './types'
import { pinKey } from './types'
import { primitiveOf } from './primitives'

/**
 * Bus-width resolution. Widths are derived (never stored) from a system of constraints
 * — connection equalities, composite-port terminal mirrors, fan-in/fan-out arity
 * constants, and the `bus-split`/`bus-merge` ×2 relations — solved by fixpoint
 * propagation. A pin that no constant reaches stays undetermined; a conflict or a
 * non-integer result (an odd width fed to a splitter) marks the sheet invalid.
 */

export interface SheetWidths {
  widths: Map<string, number>
  invalid: boolean
  reason?: 'conflict' | 'non-integer' | 'constraint'
  message?: string
}

const cache = new WeakMap<Design, Map<string, SheetWidths>>()

const IN_PROGRESS: SheetWidths = { widths: new Map(), invalid: false }

function solveWidths(design: Design, defId: string): SheetWidths {
  let perDef = cache.get(design)
  if (!perDef) {
    perDef = new Map()
    cache.set(design, perDef)
  }
  const cached = perDef.get(defId)
  if (cached) return cached

  perDef.set(defId, IN_PROGRESS)
  const result = computeSheet(design, defId)
  perDef.set(defId, result)
  return result
}

function computeSheet(design: Design, defId: string): SheetWidths {
  const def = design.defs[defId]
  const widths = new Map<string, number>()
  let invalid = false
  let reason: 'conflict' | 'non-integer' | 'constraint' | undefined
  let message: string | undefined

  const set = (ref: PinRef, value: number) => {
    const key = pinKey(ref)
    if (!Number.isInteger(value) || value < 1) {
      invalid = true
      reason = reason ?? 'non-integer'
      return
    }
    const existing = widths.get(key)
    if (existing !== undefined && existing !== value) {
      invalid = true
      reason = reason ?? 'conflict'
      return
    }
    if (existing === undefined) widths.set(key, value)
  }

  // Seed intrinsic constants and mirror composite terminals (internal is authoritative).
  for (const inst of def.instances ?? []) {
    const idef = design.defs[inst.defId]
    if (!idef) continue
    if (idef.kind === 'primitive' && idef.primitive) {
      const prim = primitiveOf(idef.primitive)
      if (prim.deriveWidth) continue // relation primitive: resolved during propagation
      for (const port of idef.ports) {
        const w = prim.intrinsicWidth(idef.ports, port, inst.props)
        if (w === null) continue // neutral (adopts the connected width)
        set({ instanceId: inst.id, portId: port.id }, w === 0 ? 1 : w)
      }
    } else if (idef.kind === 'composite') {
      for (const port of idef.ports) {
        if (!port.terminal) continue
        const child = solveWidths(design, idef.id)
        const internal = child.widths.get(pinKey({ instanceId: port.terminal.instanceId, portId: port.terminal.pinId }))
        if (internal !== undefined) set({ instanceId: inst.id, portId: port.id }, internal)
      }
    }
  }

  // Fixpoint: propagate connection equalities and relation widths.
  let changed = true
  while (changed && !invalid) {
    changed = false
    for (const conn of def.connections ?? []) {
      const a = widths.get(pinKey(conn.from))
      const b = widths.get(pinKey(conn.to))
      if (a !== undefined && b !== undefined) {
        if (a !== b) {
          invalid = true
          reason = reason ?? 'conflict'
        }
      } else if (a !== undefined) {
        set(conn.to, a)
        changed = true
      } else if (b !== undefined) {
        set(conn.from, b)
        changed = true
      }
    }
    for (const inst of def.instances ?? []) {
      const idef = design.defs[inst.defId]
      if (!idef || idef.kind !== 'primitive' || !idef.primitive) continue
      const prim = primitiveOf(idef.primitive)
      if (!prim.deriveWidth) continue
      for (const port of idef.ports) {
        const key = pinKey({ instanceId: inst.id, portId: port.id })
        if (widths.has(key)) continue
        const siblings = new Map<string, number>()
        for (const p of idef.ports) {
          if (p.id === port.id) continue
          const w = widths.get(pinKey({ instanceId: inst.id, portId: p.id }))
          if (w !== undefined) siblings.set(p.id, w)
        }
        const derived = prim.deriveWidth(port, siblings)
        if (derived !== null) {
          set({ instanceId: inst.id, portId: port.id }, derived)
          changed = true
        }
      }
    }
  }

  // Apply per-primitive width constraints (e.g. 7-seg must be a multiple of 4).
  for (const inst of def.instances ?? []) {
    const idef = design.defs[inst.defId]
    if (!idef || idef.kind !== 'primitive' || !idef.primitive) continue
    const prim = primitiveOf(idef.primitive)
    if (!prim.widthError) continue
    for (const port of idef.ports) {
      const w = widths.get(pinKey({ instanceId: inst.id, portId: port.id }))
      if (w === undefined) continue
      const err = prim.widthError(port, w)
      if (err) {
        invalid = true
        reason = reason ?? 'constraint'
        message = message ?? err
      }
    }
  }

  return { widths, invalid, reason, message }
}

/** The width of the pin referenced by `ref`, or 1 when undetermined. */
export function pinWidth(design: Design, parentDef: ComponentDef, ref: PinRef): number {
  return solveWidths(design, parentDef.id).widths.get(pinKey(ref)) ?? 1
}

/** True when the pin's width is undetermined (it adopts whatever it is wired to). */
export function isNeutralPin(design: Design, parentDef: ComponentDef, ref: PinRef): boolean {
  return !solveWidths(design, parentDef.id).widths.has(pinKey(ref))
}

/** Hover hint for a relation pin whose width is undetermined, or null. */
export function undeterminedHint(design: Design, parentDef: ComponentDef, ref: PinRef): string | null {
  const inst = parentDef.instances?.find((i) => i.id === ref.instanceId)
  if (!inst) return null
  const def = design.defs[inst.defId]
  if (!def || def.kind !== 'primitive' || !def.primitive) return null
  const prim = primitiveOf(def.primitive)
  if (!prim.undeterminedHint) return null
  const port: Port | undefined = def.ports.find((p) => p.id === ref.portId)
  if (!port) return null
  return prim.undeterminedHint(port)
}

/**
 * Return an error message if connecting `from` → `to` in `def` would make the sheet
 * invalid, or null if the connection is valid.
 */
export function connectionError(design: Design, def: ComponentDef, from: PinRef, to: PinRef): string | null {
  const testDef: ComponentDef = { ...def, connections: [...(def.connections ?? []), { id: '__test__', from, to }] }
  const testDesign: Design = { ...design, defs: { ...design.defs, [def.id]: testDef } }
  const result = solveWidths(testDesign, def.id)
  if (!result.invalid) return null
  if (result.message) return result.message
  return result.reason === 'non-integer' ? 'Bus width must be even' : 'Bus width mismatch'
}
