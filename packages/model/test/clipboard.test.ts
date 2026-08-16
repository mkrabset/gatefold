import { describe, expect, it } from 'vitest'
import type { ComponentDef, Design } from '../src/types'
import { inputPortDef, primitiveDef } from '../src/primitives'
import { captureClipboard, copyDefSubgraph, instantiateClipboard } from '../src/clipboard'

const inst = (id: string, defId: string, x = 0, y = 0) => ({ id, name: id, defId, pos: { x, y } })

function makeDesign(): Design {
  const and = primitiveDef('and')
  const inputPort = inputPortDef()
  const inner: ComponentDef = {
    id: 'inner',
    name: 'inner',
    kind: 'composite',
    ports: [],
    instances: [inst('a1', 'and'), inst('pg', 'input-port')],
    connections: [],
  }
  const outer: ComponentDef = {
    id: 'outer',
    name: 'outer',
    kind: 'composite',
    ports: [],
    instances: [inst('i1', 'inner')],
    connections: [],
  }
  const main: ComponentDef = {
    id: 'main',
    name: 'main',
    kind: 'composite',
    ports: [],
    instances: [inst('o1', 'outer', 10, 20)],
    connections: [],
  }
  return { version: 1, root: 'main', defs: { and, 'input-port': inputPort, inner, outer, main } }
}

describe('copyDefSubgraph', () => {
  it('deep-copies the transitive closure and rewrites internal defIds', () => {
    const design = makeDesign()
    const { defs, idMap } = copyDefSubgraph(design.defs, ['outer'], new Set(['outer', 'inner', 'and']))

    // closure = outer + inner + and (port groups excluded)
    expect([...idMap.keys()].sort()).toEqual(['and', 'inner', 'outer'])
    const outerCopy = defs[idMap.get('outer')!]
    const innerCopy = defs[idMap.get('inner')!]
    expect(outerCopy.variant).toBe(true)
    // internal defIds rewritten through the map
    expect(outerCopy.instances!.find((i) => i.id === 'i1')!.defId).toBe(idMap.get('inner'))
    expect(innerCopy.instances!.find((i) => i.id === 'a1')!.defId).toBe(idMap.get('and'))
  })

  it('excludes port-group primitives from the copy (they stay shared)', () => {
    const design = makeDesign()
    const { defs, idMap } = copyDefSubgraph(design.defs, ['inner'], new Set())
    expect(idMap.has('input-port')).toBe(false)
    const innerCopy = defs[idMap.get('inner')!]
    expect(innerCopy.instances!.find((i) => i.id === 'pg')!.defId).toBe('input-port')
  })
})

describe('captureClipboard + instantiateClipboard', () => {
  it('snapshots selected instances and pastes independent copies at an offset', () => {
    const design = makeDesign()
    const clip = captureClipboard(design, 'main', ['o1'])!
    expect(clip).not.toBeNull()
    expect(clip.instances).toHaveLength(1)
    expect(clip.instances[0].id).toBe('o1')

    const { design: pasted, newIds } = instantiateClipboard(design, 'main', clip, { x: 5, y: 5 })
    expect(newIds).toHaveLength(1)
    const newId = newIds[0]
    expect(newId).not.toBe('o1')

    const main = pasted.defs['main']
    const newInst = main.instances!.find((i) => i.id === newId)!
    expect(newInst.pos).toEqual({ x: 15, y: 25 })
    // the pasted instance references a fresh copy of 'outer' (not the original)
    expect(newInst.defId).not.toBe('outer')
    expect(pasted.defs[newInst.defId].variant).toBe(true)
    // original untouched
    expect(pasted.defs['main'].instances!.find((i) => i.id === 'o1')!.defId).toBe('outer')
  })

  it('paste does not collide with existing def ids on repeated pastes', () => {
    const design = makeDesign()
    const clip = captureClipboard(design, 'main', ['o1'])!
    const once = instantiateClipboard(design, 'main', clip, { x: 0, y: 0 })
    const twice = instantiateClipboard(once.design, 'main', clip, { x: 0, y: 0 })
    const main = twice.design.defs['main']
    const o1 = main.instances!.find((i) => i.id === 'o1')!
    const others = main.instances!.filter((i) => i.id !== 'o1')
    expect(others).toHaveLength(2)
    const defIds = others.map((i) => i.defId)
    expect(new Set(defIds).size).toBe(2)
    expect(defIds).not.toContain(o1.defId)
  })

  it('preserves instance props on paste', () => {
    const design = makeDesign()
    design.defs['main'].instances![0].props = { period: 250 }
    const clip = captureClipboard(design, 'main', ['o1'])!
    const { design: pasted, newIds } = instantiateClipboard(design, 'main', clip, { x: 0, y: 0 })
    const newInst = pasted.defs['main'].instances!.find((i) => i.id === newIds[0])!
    expect(newInst.props).toEqual({ period: 250 })
  })

  it('copies internal connections among the selected instances', () => {
    const defs: Record<string, ComponentDef> = {
      and: primitiveDef('and'),
      or: primitiveDef('or'),
      not: primitiveDef('not'),
    }
    defs['main'] = {
      id: 'main',
      name: 'main',
      kind: 'composite',
      ports: [],
      instances: [inst('a1', 'and', 0, 0), inst('o1', 'or', 100, 0), inst('n1', 'not', 200, 0)],
      connections: [
        { id: 'c1', from: { instanceId: 'a1', portId: 'out:0' }, to: { instanceId: 'o1', portId: 'in:0' } },
        { id: 'c2', from: { instanceId: 'o1', portId: 'out:0' }, to: { instanceId: 'n1', portId: 'in:0' } },
      ],
    }
    const design: Design = { version: 1, root: 'main', defs }

    // a1 + o1 share the internal connection c1; c2 crosses into the unselected n1.
    const clip = captureClipboard(design, 'main', ['a1', 'o1'])!
    expect(clip.connections.map((c) => c.id)).toEqual(['c1'])

    const { design: pasted, newIds } = instantiateClipboard(design, 'main', clip, { x: 10, y: 10 })
    const main = pasted.defs['main']
    expect(main.instances).toHaveLength(5)
    expect(main.connections).toHaveLength(3)

    // The pasted connection runs between the two newly-created instances.
    const pastedConn = main.connections!.find((c) => c.id !== 'c1' && c.id !== 'c2')!
    expect(newIds).toContain(pastedConn.from.instanceId)
    expect(newIds).toContain(pastedConn.to.instanceId)
    expect(pastedConn.from.portId).toBe('out:0')
    expect(pastedConn.to.portId).toBe('in:0')
  })
})
