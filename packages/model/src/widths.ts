import type { CompositeDef, PinRef, Port } from './types'
import { childPorts, primitiveOf } from './primitives'
import type { Primitive } from './primitives'

/**
 * Bus-width resolution. Widths are derived (never stored) from a system of constraints
 * — connection equalities, composite-port terminal mirrors, fan-in/fan-out arity
 * constants, and the `bus-split`/`bus-merge`/`compare` relations — solved by fixpoint
 * propagation over the **whole subtree** rooted at `root`.
 *
 * Unlike a single composite, the subtree is solved globally: a composite's terminal is
 * a *bidirectional* equality between its boundary pin (as seen from the parent) and its
 * internal port-group pin. This lets an external bus connection determine the width of
 * an otherwise-undetermined (neutral) bus *inside* a component, and vice versa. A pin
 * that no constant reaches stays undetermined; a conflict, a non-integer result (an odd
 * width fed to a splitter), or a failed `widthError` constraint marks the sheet invalid.
 */

export interface SheetWidths {
  /** Global pin key (`parentPath.instanceId:portId`) → resolved width. */
  widths: Map<string, number>
  invalid: boolean
  reason?: 'conflict' | 'non-integer' | 'constraint'
  message?: string
}

/** A relation primitive instance (bus-split/bus-merge/compare): `keys[i]` ↔ `ports[i]`. */
interface Relation {
  ports: Port[]
  keys: string[]
  prim: Primitive
}

/** A primitive instance with a per-pin width constraint (e.g. the 7-seg). */
interface Check {
  ports: Port[]
  keys: string[]
  prim: Primitive
}

/** The flat constraint model of a whole subtree, ready for the fixpoint. */
interface SheetModel {
  equalities: [string, string][]
  seeds: Map<string, number>
  relations: Relation[]
  checks: Check[]
  /** composite object → its flattened instance path ('' for the root). */
  paths: Map<CompositeDef, string>
}

const SEP = '.'

/** Join `id` onto a flattened instance path (empty path = the root). */
function joinPath(path: string, id: string): string {
  return path === '' ? id : `${path}${SEP}${id}`
}

/** The global key of an instance pin (`path` is the owning composite's path). */
function pinKeyAt(path: string, instanceId: string, portId: string): string {
  return `${joinPath(path, instanceId)}:${portId}`
}

const modelCache = new WeakMap<CompositeDef, SheetModel>()
const solutionCache = new WeakMap<CompositeDef, SheetWidths>()

/** Walk `root`'s subtree, collecting every width constraint and each composite's path. */
function collect(root: CompositeDef): SheetModel {
  const model: SheetModel = {
    equalities: [],
    seeds: new Map(),
    relations: [],
    checks: [],
    paths: new Map(),
  }
  const seen = new Set<CompositeDef>()

  const walk = (def: CompositeDef, path: string): void => {
    if (seen.has(def)) return
    seen.add(def)
    model.paths.set(def, path)

    for (const c of def.connections) {
      model.equalities.push([
        pinKeyAt(path, c.from.instanceId, c.from.portId),
        pinKeyAt(path, c.to.instanceId, c.to.portId),
      ])
    }

    // A composite terminal is an equality between its boundary pin (seen from the
    // parent) and its internal port-group pin — bidirectional, so external widths
    // propagate inward and internal widths outward.
    for (const p of def.ports) {
      if (!p.terminal) continue
      model.equalities.push([`${path}:${p.id}`, pinKeyAt(path, p.terminal.instanceId, p.terminal.pinId)])
    }

    for (const inst of def.instances) {
      const idef = inst.def
      if (idef.kind === 'composite') {
        walk(idef, joinPath(path, inst.id))
        continue
      }
      const prim = primitiveOf(idef.primitive)
      if (prim.isPortGroup()) continue // dissolved through the terminal mirrors above
      const ports = childPorts(idef)
      const keys = ports.map((p) => pinKeyAt(path, inst.id, p.id))
      if (prim.deriveWidth) {
        model.relations.push({ ports, keys, prim })
      } else {
        for (let i = 0; i < ports.length; i++) {
          const w = prim.intrinsicWidth(ports, ports[i], inst.props)
          if (w !== null) model.seeds.set(keys[i], w === 0 ? 1 : w)
        }
      }
      if (prim.widthError) model.checks.push({ ports, keys, prim })
    }
  }

  walk(root, '')
  return model
}

/** Run the fixpoint over a flat constraint model, returning the resolved widths. */
function resolve(model: SheetModel): SheetWidths {
  const widths = new Map<string, number>()
  let invalid = false
  let reason: 'conflict' | 'non-integer' | 'constraint' | undefined
  let message: string | undefined

  const set = (key: string, value: number) => {
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

  for (const [key, w] of model.seeds) set(key, w)

  let changed = true
  while (changed && !invalid) {
    changed = false
    for (const [a, b] of model.equalities) {
      const wa = widths.get(a)
      const wb = widths.get(b)
      if (wa !== undefined && wb !== undefined) {
        if (wa !== wb) {
          invalid = true
          reason = reason ?? 'conflict'
        }
      } else if (wa !== undefined) {
        set(b, wa)
        changed = true
      } else if (wb !== undefined) {
        set(a, wb)
        changed = true
      }
    }
    for (const rel of model.relations) {
      for (let i = 0; i < rel.ports.length; i++) {
        const key = rel.keys[i]
        if (widths.has(key)) continue
        const siblings = new Map<string, number>()
        for (let j = 0; j < rel.ports.length; j++) {
          if (j === i) continue
          const w = widths.get(rel.keys[j])
          if (w !== undefined) siblings.set(rel.ports[j].id, w)
        }
        const derived = rel.prim.deriveWidth!(rel.ports[i], siblings)
        if (derived !== null) {
          set(key, derived)
          changed = true
        }
      }
    }
  }

  // Apply per-primitive width constraints (e.g. 7-seg must be a multiple of 4).
  for (const ch of model.checks) {
    for (let i = 0; i < ch.ports.length; i++) {
      const w = widths.get(ch.keys[i])
      if (w === undefined) continue
      const err = ch.prim.widthError!(ch.ports[i], w)
      if (err) {
        invalid = true
        reason = reason ?? 'constraint'
        message = message ?? err
      }
    }
  }

  return { widths, invalid, reason, message }
}

/** The cached flat constraint model of `root`'s subtree. */
function modelOf(root: CompositeDef): SheetModel {
  let m = modelCache.get(root)
  if (!m) {
    m = collect(root)
    modelCache.set(root, m)
  }
  return m
}

/** The cached width solution of `root`'s subtree (bidirectional, global). */
export function solveWidths(root: CompositeDef): SheetWidths {
  let s = solutionCache.get(root)
  if (!s) {
    s = resolve(modelOf(root))
    solutionCache.set(root, s)
  }
  return s
}

/** The flattened path of `parentDef` within `root`, or undefined when not under it. */
function pathOf(root: CompositeDef, parentDef: CompositeDef): string | undefined {
  return modelOf(root).paths.get(parentDef)
}

/** The width of the pin referenced by `ref` (in `parentDef`), or 1 when undetermined. */
export function pinWidth(root: CompositeDef, parentDef: CompositeDef, ref: PinRef): number {
  const path = pathOf(root, parentDef)
  if (path === undefined) return 1
  return solveWidths(root).widths.get(pinKeyAt(path, ref.instanceId, ref.portId)) ?? 1
}

/** True when the pin's width is undetermined (it adopts whatever it is wired to). */
export function isNeutralPin(root: CompositeDef, parentDef: CompositeDef, ref: PinRef): boolean {
  const path = pathOf(root, parentDef)
  if (path === undefined) return true
  return !solveWidths(root).widths.has(pinKeyAt(path, ref.instanceId, ref.portId))
}

/** The width of the pin referenced by `ref`, or null when it is undetermined. */
export function resolvedPinWidth(root: CompositeDef, parentDef: CompositeDef, ref: PinRef): number | null {
  const path = pathOf(root, parentDef)
  if (path === undefined) return null
  return solveWidths(root).widths.get(pinKeyAt(path, ref.instanceId, ref.portId)) ?? null
}

/** Hover hint for a relation pin whose width is undetermined, or null. */
export function undeterminedHint(parentDef: CompositeDef, ref: PinRef): string | null {
  const inst = parentDef.instances.find((i) => i.id === ref.instanceId)
  if (!inst || inst.def.kind === 'composite') return null
  const prim = primitiveOf(inst.def.primitive)
  if (!prim.undeterminedHint) return null
  const port = childPorts(inst.def).find((p) => p.id === ref.portId)
  if (!port) return null
  return prim.undeterminedHint(port)
}

/**
 * Return an error message if connecting `from` → `to` in `parentDef` would make the
 * sheet invalid, or null if the connection is valid. Resolves against the whole `root`
 * subtree so cross-boundary widths are honored.
 */
export function connectionError(root: CompositeDef, parentDef: CompositeDef, from: PinRef, to: PinRef): string | null {
  const model = modelOf(root)
  const path = model.paths.get(parentDef)
  if (path === undefined) return null
  const extra: [string, string] = [
    pinKeyAt(path, from.instanceId, from.portId),
    pinKeyAt(path, to.instanceId, to.portId),
  ]
  const result = resolve({ ...model, equalities: [...model.equalities, extra] })
  if (!result.invalid) return null
  if (result.message) return result.message
  return result.reason === 'non-integer' ? 'Bus width must be even' : 'Bus width mismatch'
}
