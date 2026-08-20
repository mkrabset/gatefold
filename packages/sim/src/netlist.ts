import type { ComponentDef, Design, Instance, PrimitiveKind } from '@logica/model'
import { isPortGroupDef, pinWidth } from '@logica/model'

export interface FlatPort {
  portId: string
  net: number
  inverted: boolean
}

export interface FlatInstance {
  /** Flattened instance id: a `.`-joined path of original instance ids from the root. */
  id: string
  kind: PrimitiveKind
  props?: Record<string, unknown>
  inputs: FlatPort[]
  outputs: FlatPort[]
}

export interface Netlist {
  instances: FlatInstance[]
  netCount: number
  netWidths: number[]
}

/** Minimal union-find over string keys. */
class UnionFind {
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

interface Leaf {
  id: string
  inst: Instance
  def: ComponentDef
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

  const join = (path: string, id: string): string => (path === '' ? id : `${path}.${id}`)
  const pinKey = (instancePath: string, portId: string): string => `${instancePath}:${portId}`

  const flattenDef = (defId: string, path: string): void => {
    const def = design.defs[defId]
    if (!def) return

    for (const c of def.connections ?? []) {
      uf.union(pinKey(join(path, c.from.instanceId), c.from.portId), pinKey(join(path, c.to.instanceId), c.to.portId))
    }

    for (const p of def.ports) {
      if (!p.terminal) continue
      if (path === '') continue // the root has no parent boundary
      uf.union(pinKey(path, p.id), pinKey(join(path, p.terminal.instanceId), p.terminal.pinId))
    }

    for (const inst of def.instances ?? []) {
      const idef = design.defs[inst.defId]
      if (!idef) continue
      if (isPortGroupDef(idef)) continue // dissolved through terminals
      const childPath = join(path, inst.id)
      if (idef.kind === 'composite') {
        flattenDef(inst.defId, childPath)
      } else {
        leaves.push({ id: childPath, inst, def: idef, parentDef: def })
      }
    }
  }

  flattenDef(design.root, '')

  const netIds = new Map<string, number>()
  const netWidths: number[] = []
  const netIdOf = (key: string): number => {
    const root = uf.find(key)
    let id = netIds.get(root)
    if (id === undefined) {
      id = netWidths.length
      netIds.set(root, id)
      netWidths.push(1)
    }
    return id
  }

  const instances: FlatInstance[] = []
  for (const leaf of leaves) {
    const kind = leaf.def.primitive!
    const inputs: FlatPort[] = []
    const outputs: FlatPort[] = []
    for (const p of leaf.def.ports) {
      const net = netIdOf(pinKey(leaf.id, p.id))
      const w = pinWidth(design, leaf.parentDef, { instanceId: leaf.inst.id, portId: p.id })
      if (w > netWidths[net]) netWidths[net] = w
      const port = { portId: p.id, net, inverted: p.inverted === true }
      if (p.direction === 'input') inputs.push(port)
      else outputs.push(port)
    }
    instances.push({ id: leaf.id, kind, props: leaf.inst.props, inputs, outputs })
  }

  return { instances, netCount: netWidths.length, netWidths }
}
