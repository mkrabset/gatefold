import { describe, expect, it } from 'vitest'
import type { CompositeDef } from '../src/types'
import { allCompositeIds, collectCompositeSubtree, findComposite, uniqueId, walkComposites } from '../src/util'

const composite = (id: string, instances: CompositeDef[] = []): CompositeDef => ({
  id,
  name: id,
  kind: 'composite',
  ports: [],
  instances: instances.map((inner) => ({ id: `${id}-${inner.id}`, name: inner.name, def: inner, pos: { x: 0, y: 0 } })),
  connections: [],
})

describe('uniqueId', () => {
  it('returns the base when unused, else suffixes it', () => {
    expect(uniqueId(new Set(['a']), 'b')).toBe('b')
    expect(uniqueId(new Set(['a']), 'a')).toBe('a-2')
    expect(uniqueId(new Set(['a', 'a-2']), 'a')).toBe('a-3')
  })
})

describe('walkComposites / collectCompositeSubtree', () => {
  it('walks every composite in the nested subtree in pre-order', () => {
    const inner = composite('inner')
    const outer = composite('outer', [inner])
    const root = composite('main', [outer])

    const visited: string[] = []
    walkComposites(root, (d) => visited.push(d.id))
    expect(visited).toEqual(['main', 'outer', 'inner'])
    expect(collectCompositeSubtree(root)).toEqual(new Set(['main', 'outer', 'inner']))
  })
})

describe('allCompositeIds / findComposite', () => {
  it('collects every composite id in the content tree and library', () => {
    const inner = composite('inner')
    const outer = composite('outer', [inner])
    const root = composite('main', [outer])
    const tpl = composite('tpl')
    const design = { root, library: { tpl } }

    expect(allCompositeIds(design)).toEqual(new Set(['main', 'outer', 'inner', 'tpl']))
    expect(findComposite(design, 'inner')?.id).toBe('inner')
    expect(findComposite(design, 'tpl')?.id).toBe('tpl')
    expect(findComposite(design, 'missing')).toBeUndefined()
  })
})
