import { describe, expect, it } from 'vitest'
import type { ChildDef, CompositeDef, Design, Instance } from '../src/types'
import { forkOf } from '../src/primitives'
import { allCompositeIds } from '../src/util'
import { captureClipboard, instantiateClipboard } from '../src/clipboard'

const inst = (id: string, def: ChildDef, x = 0, y = 0): Instance => ({ id, name: id, def, pos: { x, y } })
const INPUT_PORT: ChildDef = { kind: 'builtin', primitive: 'input-port' }

function makeDesign(): Design {
  const inner: CompositeDef = {
    id: 'inner',
    name: 'inner',
    kind: 'composite',
    ports: [],
    instances: [inst('a1', forkOf('and')), inst('pg', INPUT_PORT)],
    connections: [],
  }
  const outer: CompositeDef = {
    id: 'outer',
    name: 'outer',
    kind: 'composite',
    ports: [],
    instances: [inst('i1', inner)],
    connections: [],
  }
  const main: CompositeDef = {
    id: 'main',
    name: 'main',
    kind: 'composite',
    ports: [],
    instances: [inst('o1', outer, 10, 20)],
    connections: [],
  }
  return { version: 2, root: main, library: {} }
}

describe('captureClipboard + instantiateClipboard', () => {
  it('snapshots selected instances and pastes independent copies at an offset', () => {
    const design = makeDesign()
    const clip = captureClipboard(design.root, ['o1'])!
    expect(clip).not.toBeNull()
    expect(clip.instances).toHaveLength(1)
    expect(clip.instances[0].id).toBe('o1')

    const newIds = instantiateClipboard(design.root, clip, allCompositeIds(design), { x: 5, y: 5 })
    expect(newIds).toHaveLength(1)
    const newId = newIds[0]
    expect(newId).not.toBe('o1')

    const newInst = design.root.instances.find((i) => i.id === newId)!
    expect(newInst.pos).toEqual({ x: 15, y: 25 })
    // the pasted instance references a fresh copy of 'outer' (not the original)
    expect(newInst.def.kind === 'composite' && newInst.def.id).not.toBe('outer')
    // original untouched
    expect(design.root.instances.find((i) => i.id === 'o1')!.def).toEqual(
      expect.objectContaining({ id: 'outer' }),
    )
  })

  it('paste does not collide with existing composite ids on repeated pastes', () => {
    const design = makeDesign()
    const main = design.root
    const clip = captureClipboard(main, ['o1'])!
    instantiateClipboard(main, clip, allCompositeIds(design), { x: 0, y: 0 })
    instantiateClipboard(main, clip, allCompositeIds(design), { x: 0, y: 0 })
    const o1 = main.instances.find((i) => i.id === 'o1')!
    const others = main.instances.filter((i) => i.id !== 'o1')
    expect(others).toHaveLength(2)
    const defIds = others.map((i) => (i.def.kind === 'composite' ? i.def.id : ''))
    expect(new Set(defIds).size).toBe(2)
    expect(defIds).not.toContain(o1.def.kind === 'composite' ? o1.def.id : '')
  })

  it('preserves instance props on paste', () => {
    const design = makeDesign()
    design.root.instances[0].props = { period: 250 }
    const clip = captureClipboard(design.root, ['o1'])!
    const newIds = instantiateClipboard(design.root, clip, allCompositeIds(design), { x: 0, y: 0 })
    const newInst = design.root.instances.find((i) => i.id === newIds[0])!
    expect(newInst.props).toEqual({ period: 250 })
  })

  it('preserves the lineage uuid on pasted copies', () => {
    const design = makeDesign()
    const outer = design.root.instances[0].def as CompositeDef
    outer.uuid = 'U-outer'
    const clip = captureClipboard(design.root, ['o1'])!
    const newIds = instantiateClipboard(design.root, clip, allCompositeIds(design), { x: 0, y: 0 })
    const newInst = design.root.instances.find((i) => i.id === newIds[0])!
    expect((newInst.def as CompositeDef).uuid).toBe('U-outer')
  })

  it('copies internal connections among the selected instances', () => {
    const main: CompositeDef = {
      id: 'main',
      name: 'main',
      kind: 'composite',
      ports: [],
      instances: [inst('a1', forkOf('and'), 0, 0), inst('o1', forkOf('or'), 100, 0), inst('n1', forkOf('not'), 200, 0)],
      connections: [
        { id: 'c1', from: { instanceId: 'a1', portId: 'out:0' }, to: { instanceId: 'o1', portId: 'in:0' } },
        { id: 'c2', from: { instanceId: 'o1', portId: 'out:0' }, to: { instanceId: 'n1', portId: 'in:0' } },
      ],
    }
    const design: Design = { version: 2, root: main, library: {} }

    const clip = captureClipboard(main, ['a1', 'o1'])!
    expect(clip.connections.map((c) => c.id)).toEqual(['c1'])

    const newIds = instantiateClipboard(main, clip, allCompositeIds(design), { x: 10, y: 10 })
    expect(main.instances).toHaveLength(5)
    expect(main.connections).toHaveLength(3)

    const pastedConn = main.connections.find((c) => c.id !== 'c1' && c.id !== 'c2')!
    expect(newIds).toContain(pastedConn.from.instanceId)
    expect(newIds).toContain(pastedConn.to.instanceId)
    expect(pastedConn.from.portId).toBe('out:0')
    expect(pastedConn.to.portId).toBe('in:0')
  })

  it('excludes port-group instances and their connections', () => {
    const main: CompositeDef = {
      id: 'main',
      name: 'main',
      kind: 'composite',
      ports: [],
      instances: [inst('a1', forkOf('and'), 0, 0), inst('pg', INPUT_PORT, 100, 0)],
      connections: [{ id: 'c1', from: { instanceId: 'pg', portId: 'in:0' }, to: { instanceId: 'a1', portId: 'in:0' } }],
    }
    const clip = captureClipboard(main, ['a1', 'pg'])!
    expect(clip.instances.map((i) => i.id)).toEqual(['a1'])
    expect(clip.connections).toHaveLength(0)
  })

  it('returns null when only port groups are selected', () => {
    const main: CompositeDef = {
      id: 'main',
      name: 'main',
      kind: 'composite',
      ports: [],
      instances: [inst('pg', INPUT_PORT, 0, 0)],
      connections: [],
    }
    expect(captureClipboard(main, ['pg'])).toBeNull()
  })
})
