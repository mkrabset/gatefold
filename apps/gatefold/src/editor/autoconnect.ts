import type { ChildDef, CompositeDef, Instance, PinRef } from '@gatefold/model'
import { childPorts, childPrimitive, connectionError, findConnectionTo, inputPorts, isPortGroupDef, outputPorts, pinKey, portGroupDirection } from '@gatefold/model'
import { portPosition } from './geometry'

/**
 * Proximity auto-connect ("magnetic wiring"): while components are selected, match each
 * of their unconnected terminals to the nearest compatible terminal on a nearby
 * component, so pressing the `c` hotkey wires every match at once. Matching is pure
 * geometry + the existing width validation — it never mutates the design; the store
 * action applies the results.
 */

/** A proposed connection: drive `to` from `from` (already width-compatible). */
export interface AutoMatch {
  from: PinRef
  to: PinRef
}

/** Maximum distance (world units) between two pin centers that still qualifies as a
 *  match. Roughly one gate-width of clearance, so adjacent components snap while distant
 *  ones are ignored. */
export const AUTO_CONNECT_RADIUS = 20

/** A terminal of an instance: its pin reference and its world-space position. */
interface Terminal {
  ref: PinRef
  pos: { x: number; y: number }
}

/** True for the single-wire join-point (NODE), whose terminals coincide at the center. */
function isJoinpoint(def: ChildDef): boolean {
  return childPrimitive(def) === 'join-point'
}

/**
 * Enumerate an instance's connectable terminals as sources (output pins; an `input-port`
 * group's pins) and sinks (input pins; an `output-port` group's pins). Join-points are
 * excluded by the caller; they never participate in auto-connect.
 */
function terminalsOf(root: CompositeDef, parentDef: CompositeDef, inst: Instance): { sources: Terminal[]; sinks: Terminal[] } {
  const def = inst.def
  const posOf = (portId: string) => portPosition(root, parentDef, inst, def, portId)
  const refOf = (portId: string): PinRef => ({ instanceId: inst.id, portId })

  if (isPortGroupDef(def)) {
    const isInput = portGroupDirection(def) === 'input'
    const ports = isInput ? inputPorts(parentDef.ports) : outputPorts(parentDef.ports)
    const terms = ports.map((p) => ({ ref: refOf(p.id), pos: posOf(p.id) }))
    return isInput ? { sources: terms, sinks: [] } : { sources: [], sinks: terms }
  }

  const ports = childPorts(def)
  return {
    sources: outputPorts(ports).map((p) => ({ ref: refOf(p.id), pos: posOf(p.id) })),
    sinks: inputPorts(ports).map((p) => ({ ref: refOf(p.id), pos: posOf(p.id) })),
  }
}

/**
 * Compute the auto-connect matches for the currently selected instances in `parentDef`:
 * each undriven input of a selected instance is paired with the nearest compatible
 * source, and each output with the nearest compatible undriven input. Candidates come
 * from every other instance in the sheet (including the port groups), excluding
 * join-points and the selected instance itself. A sink is driven by at most one source,
 * so the final result is deduplicated by sink, closest source winning.
 */
export function computeAutoConnectMatches(root: CompositeDef, parentDef: CompositeDef, selectedIds: string[]): AutoMatch[] {
  if (selectedIds.length === 0) return []
  const selected = new Set(selectedIds)

  // Precompute terminals once per instance (positions are stable within one call).
  const all = parentDef.instances
    .filter((inst) => !isJoinpoint(inst.def))
    .map((inst) => ({ inst, ...terminalsOf(root, parentDef, inst) }))

  const candidates: { from: PinRef; to: PinRef; d: number }[] = []

  for (const { inst, sources, sinks } of all) {
    if (!selected.has(inst.id)) continue
    if (isPortGroupDef(inst.def)) continue

    // Unconnected inputs → nearest compatible source.
    for (const sink of sinks) {
      if (findConnectionTo(parentDef.connections, sink.ref)) continue
      let best: { from: PinRef; to: PinRef; d: number } | null = null
      for (const other of all) {
        if (other.inst.id === inst.id) continue
        for (const src of other.sources) {
          const d = Math.hypot(src.pos.x - sink.pos.x, src.pos.y - sink.pos.y)
          if (d > AUTO_CONNECT_RADIUS || (best && d >= best.d)) continue
          if (connectionError(root, parentDef, src.ref, sink.ref)) continue
          best = { from: src.ref, to: sink.ref, d }
        }
      }
      if (best) candidates.push(best)
    }

    // Outputs → nearest compatible unconnected input.
    for (const src of sources) {
      let best: { from: PinRef; to: PinRef; d: number } | null = null
      for (const other of all) {
        if (other.inst.id === inst.id) continue
        for (const sink of other.sinks) {
          if (findConnectionTo(parentDef.connections, sink.ref)) continue
          const d = Math.hypot(src.pos.x - sink.pos.x, src.pos.y - sink.pos.y)
          if (d > AUTO_CONNECT_RADIUS || (best && d >= best.d)) continue
          if (connectionError(root, parentDef, src.ref, sink.ref)) continue
          best = { from: src.ref, to: sink.ref, d }
        }
      }
      if (best) candidates.push(best)
    }
  }

  // Single-driver invariant: each sink gets the closest of its candidate sources.
  const bySink = new Map<string, { from: PinRef; to: PinRef; d: number }>()
  for (const c of candidates) {
    const key = pinKey(c.to)
    const existing = bySink.get(key)
    if (!existing || c.d < existing.d) bySink.set(key, c)
  }

  return [...bySink.values()].map(({ from, to }) => ({ from, to }))
}
