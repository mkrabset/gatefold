import { describe, expect, it } from 'vitest'
import type { ComponentDef, Design } from '../src/types'
import { unreachableDefIds } from '../src/util'

describe('unreachableDefIds', () => {
  it('keeps root/templates/built-ins and reachable variants, returns orphaned variants', () => {
    const design: Design = {
      version: 1,
      root: 'main',
      defs: {
        and: { id: 'and', name: 'AND', kind: 'primitive', primitive: 'and', ports: [] },
        tpl: { id: 'tpl', name: 'tpl', kind: 'composite', ports: [], instances: [], connections: [] },
        main: {
          id: 'main',
          name: 'main',
          kind: 'composite',
          ports: [],
          instances: [{ id: 'a', name: 'a', defId: 'tpl~x', pos: { x: 0, y: 0 } }],
          connections: [],
        },
        // Reachable (referenced by main) — must be kept.
        'tpl~x': { id: 'tpl~x', name: 'tpl', kind: 'composite', variant: true, ports: [], instances: [], connections: [] },
        // Orphaned variant, and its nested orphan — must be returned.
        orphan: {
          id: 'orphan',
          name: 'old',
          kind: 'composite',
          variant: true,
          ports: [],
          instances: [{ id: 'oi', name: 'oi', defId: 'orphan-inner', pos: { x: 0, y: 0 } }],
          connections: [],
        },
        'orphan-inner': { id: 'orphan-inner', name: 'inner', kind: 'composite', variant: true, ports: [], instances: [], connections: [] },
      },
    }

    expect(unreachableDefIds(design)).toEqual(new Set(['orphan', 'orphan-inner']))
  })

  it('returns an empty set when there are no orphans', () => {
    const tpl: ComponentDef = { id: 'tpl', name: 'tpl', kind: 'composite', ports: [], instances: [], connections: [] }
    const design: Design = {
      version: 1,
      root: 'main',
      defs: { main: { id: 'main', name: 'main', kind: 'composite', ports: [], instances: [], connections: [] }, tpl },
    }
    expect(unreachableDefIds(design)).toEqual(new Set())
  })
})
