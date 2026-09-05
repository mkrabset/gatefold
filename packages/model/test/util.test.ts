import { describe, expect, it } from 'vitest'
import type { ComponentDef, Design } from '../src/types'
import { collectClosure, remapInstanceDefs, uniqueId, unreachableDefIds } from '../src/util'

describe('uniqueId', () => {
  it('returns the base when unused, else suffixes it', () => {
    expect(uniqueId(new Set(['a']), 'b')).toBe('b')
    expect(uniqueId(new Set(['a']), 'a')).toBe('a-2')
    expect(uniqueId(new Set(['a', 'a-2']), 'a')).toBe('a-3')
  })
})

describe('collectClosure', () => {
  it('collects a root and its transitive composite closure', () => {
    const defs: Record<string, ComponentDef> = {
      outer: {
        id: 'outer', name: 'outer', kind: 'composite', ports: [],
        instances: [{ id: 'i', name: 'i', defId: 'inner', pos: { x: 0, y: 0 } }],
        connections: [],
      },
      inner: {
        id: 'inner', name: 'inner', kind: 'composite', ports: [],
        instances: [{ id: 'g', name: 'g', defId: 'and', pos: { x: 0, y: 0 } }],
        connections: [],
      },
      and: { id: 'and', name: 'AND', kind: 'primitive', primitive: 'and', ports: [] },
      solo: { id: 'solo', name: 'solo', kind: 'composite', ports: [], instances: [], connections: [] },
    }
    const closure = collectClosure(defs, ['outer'], (d) => d.kind === 'primitive' && d.primitive === 'and')
    expect(closure.has('outer')).toBe(true)
    expect(closure.has('inner')).toBe(true)
    expect(closure.has('and')).toBe(false) // skipped
    expect(closure.has('solo')).toBe(false)
  })
})

describe('remapInstanceDefs', () => {
  it('rewrites instance defIds through the id map', () => {
    const def: ComponentDef = {
      id: 'x', name: 'x', kind: 'composite', ports: [],
      instances: [
        { id: 'a', name: 'a', defId: 'old-a', pos: { x: 0, y: 0 } },
        { id: 'b', name: 'b', defId: 'keep', pos: { x: 0, y: 0 } },
      ],
      connections: [],
    }
    remapInstanceDefs(def, new Map([['old-a', 'new-a']]))
    expect(def.instances![0].defId).toBe('new-a')
    expect(def.instances![1].defId).toBe('keep')
  })

  it('is a no-op for primitive defs', () => {
    const def: ComponentDef = { id: 'and', name: 'AND', kind: 'primitive', primitive: 'and', ports: [] }
    remapInstanceDefs(def, new Map([['and', 'x']]))
    expect(def.kind).toBe('primitive')
  })
})

describe('unreachableDefIds', () => {
  it('keeps root/templates/built-ins and reachable defs, returns orphaned content defs', () => {
    const design: Design = {
      version: 1,
      root: 'main',
      library: {
        tpl: { id: 'tpl', name: 'tpl', kind: 'composite', ports: [], instances: [], connections: [] },
      },
      defs: {
        and: { id: 'and', name: 'AND', kind: 'primitive', primitive: 'and', ports: [] },
        main: {
          id: 'main',
          name: 'main',
          kind: 'composite',
          ports: [],
          instances: [{ id: 'a', name: 'a', defId: 'live', pos: { x: 0, y: 0 } }],
          connections: [],
        },
        // Reachable (referenced by main) — must be kept.
        live: { id: 'live', name: 'live', kind: 'composite', ports: [], instances: [], connections: [] },
        // Orphaned def, and its nested orphan — must be returned.
        orphan: {
          id: 'orphan',
          name: 'old',
          kind: 'composite',
          ports: [],
          instances: [{ id: 'oi', name: 'oi', defId: 'orphan-inner', pos: { x: 0, y: 0 } }],
          connections: [],
        },
        'orphan-inner': { id: 'orphan-inner', name: 'inner', kind: 'composite', ports: [], instances: [], connections: [] },
      },
    }

    expect(unreachableDefIds(design)).toEqual(new Set(['orphan', 'orphan-inner']))
  })

  it('returns an empty set when there are no orphans', () => {
    const design: Design = {
      version: 1,
      root: 'main',
      library: {},
      defs: { main: { id: 'main', name: 'main', kind: 'composite', ports: [], instances: [], connections: [] } },
    }
    expect(unreachableDefIds(design)).toEqual(new Set())
  })
})
