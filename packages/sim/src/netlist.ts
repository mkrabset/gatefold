import type { ComponentDef, Design, Instance, PrimitiveDef, PrimitiveKind, PropertyValue } from '@gatefold/model'
import { isPortGroupDef, pinWidth, UnionFind } from '@gatefold/model'

export interface FlatPort {
  portId: string
  net: number
  inverted: boolean
}

export interface FlatInstance {
  /** Flattened instance id: a `.`-joined path of original instance ids from the root. */
  id: string
  kind: PrimitiveKind
  props?: Record<string, PropertyValue>
  inputs: FlatPort[]
  outputs: FlatPort[]
}

export interface Netlist {
  instances: FlatInstance[]
  netCount: number
  netWidths: number[]
  /** True for nets driven by a gate/source output (false = floating input). */
  driven: boolean[]
  /** Maps every flattened pin key (`instancePath:portId`) to its net, including
   *  port-group and composite-boundary pins (not just leaf primitives). */
  pinNet: Map<string, number>
}

/** Separator joining instance ids into a flattened `.`-path (shared with the app). */
export const INSTANCE_PATH_SEP = '.'

/** Append `id` to a flattened instance path (empty path = the root). */
export function joinInstancePath(path: string, id: string): string {
  return path === '' ? id : `${path}${INSTANCE_PATH_SEP}${id}`
}

interface Leaf {
  id: string
  inst: Instance
  def: PrimitiveDef
  parentDef: ComponentDef
}

/**
 * Flatten a hierarchical design into a list of primitive instances connected by nets.
 * Composite boundaries are dissolved through `Port.terminal`: the composite's own pin
 * is unioned with the internal port-group pin, and connections union their endpoints.
 */
export function flatten(design: Design): Netlist {
  const uf = new UnionFind()
  const leaves: Leaf[] = []
  const allPins = new Set<string>()
  /** Inverted composite terminals, resolved into synthesized inverters after nets are assigned. */
  const inverters: { source: string; target: string }[] = []

  const join = (path: string, id: string): string => joinInstancePath(path, id)
  const pinKey = (instancePath: string, portId: string): string => `${instancePath}:${portId}`

  const flattenDef = (defId: string, path: string): void => {
    const def = design.defs[defId]
    if (!def || def.kind !== 'composite') return

    for (const c of def.connections ?? []) {
      const fk = pinKey(join(path, c.from.instanceId), c.from.portId)
      const tk = pinKey(join(path, c.to.instanceId), c.to.portId)
      allPins.add(fk)
      allPins.add(tk)
      uf.union(fk, tk)
    }

    for (const p of def.ports) {
      if (!p.terminal) continue
      if (path === '') continue // the root has no parent boundary
      const bk = pinKey(path, p.id)
      const ik = pinKey(join(path, p.terminal.instanceId), p.terminal.pinId)
      allPins.add(bk)
      allPins.add(ik)
      if (p.inverted === true) {
        // Inverted composite terminal: the boundary pin and the internal port-group pin
        // are separate nets joined by a synthesized inverter (an input inverts on the way
        // in, an output on the way out). Deferred until after nets are assigned.
        if (p.direction === 'input') inverters.push({ source: bk, target: ik })
        else inverters.push({ source: ik, target: bk })
      } else {
        uf.union(bk, ik)
      }
    }

    for (const inst of def.instances ?? []) {
      const idef = design.defs[inst.defId]
      if (!idef) continue
      if (isPortGroupDef(idef)) continue // dissolved through terminals
      const childPath = join(path, inst.id)
      if (idef.kind === 'composite') {
        flattenDef(inst.defId, childPath)
      } else {
        for (const p of idef.ports) allPins.add(pinKey(childPath, p.id))
        leaves.push({ id: childPath, inst, def: idef, parentDef: def })
      }
    }
  }

  flattenDef(design.root, '')

  const netIds = new Map<string, number>()
  const netWidths: number[] = []
  const driven: boolean[] = []
  const netIdOf = (key: string): number => {
    const root = uf.find(key)
    let id = netIds.get(root)
    if (id === undefined) {
      id = netWidths.length
      netIds.set(root, id)
      netWidths.push(1)
      driven.push(false)
    }
    return id
  }

  const instances: FlatInstance[] = []
  for (const leaf of leaves) {
    const kind = leaf.def.primitive
    const inputs: FlatPort[] = []
    const outputs: FlatPort[] = []
    for (const p of leaf.def.ports) {
      const net = netIdOf(pinKey(leaf.id, p.id))
      const w = pinWidth(design, leaf.parentDef, { instanceId: leaf.inst.id, portId: p.id })
      if (w > netWidths[net]) netWidths[net] = w
      const port = { portId: p.id, net, inverted: p.inverted === true }
      if (p.direction === 'input') inputs.push(port)
      else {
        outputs.push(port)
        driven[net] = true
      }
    }
    instances.push({ id: leaf.id, kind, props: leaf.inst.props, inputs, outputs })
  }

  // Synthesized inverters for inverted composite terminals: a buffer whose output is
  // inverted (a NOT), evaluated with the configured gate delay.
  let invCounter = 0
  for (const inv of inverters) {
    const sourceNet = netIdOf(inv.source)
    const targetNet = netIdOf(inv.target)
    driven[targetNet] = true
    instances.push({
      id: `$inv${invCounter++}`,
      kind: 'buffer',
      inputs: [{ portId: 'in:0', net: sourceNet, inverted: false }],
      outputs: [{ portId: 'out:0', net: targetNet, inverted: true }],
    })
  }

  // Resolve the net for every pin (leaf primitives, port groups, and composite pins),
  // so the engine can answer signals for any of them.
  const pinNet = new Map<string, number>()
  for (const key of allPins) pinNet.set(key, netIdOf(key))

  return { instances, netCount: netWidths.length, netWidths, driven, pinNet }
}
