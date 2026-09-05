import type { CompositeDef, Connection, Instance } from './types'
import { nextConnectionId } from './types'
import { cloneChildDef } from './group'
import { isPortGroupDef } from './primitives'
import { uniqueId } from './util'

/**
 * Copy/paste primitives. A clipboard is a self-contained snapshot: deep-copied
 * instances (with their inline child defs) plus the connections that run entirely
 * within the copied selection. Because the app uses copy-on-place, pasting re-copies
 * the whole selection so each paste is fully independent of the originals.
 */

export interface Clipboard {
  instances: Instance[]
  /** Connections whose both endpoints are within the copied selection. */
  connections: Connection[]
}

/**
 * Snapshot the selected instances (and their inline defs) into a clipboard. Port-group
 * instances (a composite's input/output terminal rectangles) are never copied — they
 * are derived from the enclosing composite's ports.
 */
export function captureClipboard(parent: CompositeDef, instanceIds: string[]): Clipboard | null {
  const selected = parent.instances.filter((i) => instanceIds.includes(i.id) && !isPortGroupDef(i.def))
  if (selected.length === 0) return null

  const selectedIds = new Set(selected.map((i) => i.id))
  const connections = parent.connections
    .filter((c) => selectedIds.has(c.from.instanceId) && selectedIds.has(c.to.instanceId))
    .map((c) => ({ id: c.id, from: { ...c.from }, to: { ...c.to } }))

  const instances = selected.map((inst) => ({
    id: inst.id,
    name: inst.name,
    pos: { ...inst.pos },
    ...(inst.props ? { props: { ...inst.props } } : {}),
    def: cloneChildDef(inst.def, new Set()),
  }))

  return { instances, connections }
}

/**
 * Paste a clipboard into a composite, re-copying with fresh instance and composite ids
 * and offsetting the positions. Mutates `parent` (an immer draft in the app) and
 * returns the ids of the newly created instances.
 */
export function instantiateClipboard(
  parent: CompositeDef,
  clipboard: Clipboard,
  usedIds: Set<string>,
  offset: { x: number; y: number },
): string[] {
  const usedInstanceIds = new Set(parent.instances.map((i) => i.id))
  const instIdMap = new Map<string, string>()
  const newIds: string[] = []
  for (const inst of clipboard.instances) {
    const id = uniqueId(usedInstanceIds, inst.id, '~')
    usedInstanceIds.add(id)
    instIdMap.set(inst.id, id)
    parent.instances.push({
      id,
      name: inst.name,
      pos: { x: inst.pos.x + offset.x, y: inst.pos.y + offset.y },
      ...(inst.props ? { props: { ...inst.props } } : {}),
      def: cloneChildDef(inst.def, usedIds),
    })
    newIds.push(id)
  }

  // Re-create the connections that ran entirely within the copied selection, using
  // the freshly-assigned instance ids.
  for (const c of clipboard.connections) {
    const from = instIdMap.get(c.from.instanceId)
    const to = instIdMap.get(c.to.instanceId)
    if (!from || !to) continue
    parent.connections.push({
      id: nextConnectionId(parent.connections),
      from: { instanceId: from, portId: c.from.portId },
      to: { instanceId: to, portId: c.to.portId },
    })
  }

  return newIds
}
