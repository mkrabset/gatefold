import { describe, expect, it } from 'vitest'
import type { CompositeDef, Design } from '@gatefold/model'
import { builtinOf, forkOf } from '@gatefold/model'
import { applyTemplate, scopeDefIds } from './apply'

const iref = (instanceId: string, portId: string) => ({ instanceId, portId })
const pg = (id: string, kind: 'input-port' | 'output-port', x: number, y: number) => ({ id, name: '', def: builtinOf(kind), pos: { x, y } })
const gate = (id: string, kind: Parameters<typeof forkOf>[0], name = 'g', x = 60, y = 0) => ({ id, name, def: forkOf(kind), pos: { x, y } })

const tplPorts = (inId: string, outId: string) => [
  { id: 'in:0', name: 'A', direction: 'input' as const, terminal: { instanceId: inId, pinId: 'in:0' } },
  { id: 'in:1', name: 'B', direction: 'input' as const, terminal: { instanceId: inId, pinId: 'in:1' } },
  { id: 'out:0', name: 'Y', direction: 'output' as const, terminal: { instanceId: outId, pinId: 'out:0' } },
]

function makeApplyDesign(): Design {
  const library: Record<string, CompositeDef> = {}

  library['tpl'] = {
    id: 'tpl', name: 'tpl', kind: 'composite', uuid: 'U',
    ports: tplPorts('t-in', 't-out'),
    instances: [
      pg('t-in', 'input-port', 0, 0),
      gate('t-g', 'and', 'g', 60, 0),
      pg('t-out', 'output-port', 120, 0),
    ],
    connections: [
      { id: 'c1', from: iref('t-in', 'in:0'), to: iref('t-g', 'in:0') },
      { id: 'c2', from: iref('t-in', 'in:1'), to: iref('t-g', 'in:1') },
      { id: 'c3', from: iref('t-g', 'out:0'), to: iref('t-out', 'out:0') },
    ],
  }

  // A matching live copy: same interface, but OR internals and an inverted input.
  const v: CompositeDef = {
    id: 'v', name: 'v', kind: 'composite', uuid: 'U',
    ports: [
      { id: 'in:0', name: 'A', direction: 'input', terminal: { instanceId: 'v-in', pinId: 'in:0' }, inverted: true },
      { id: 'in:1', name: 'B', direction: 'input', terminal: { instanceId: 'v-in', pinId: 'in:1' } },
      { id: 'out:0', name: 'Y', direction: 'output', terminal: { instanceId: 'v-out', pinId: 'out:0' } },
    ],
    instances: [pg('v-in', 'input-port', 0, 0), gate('v-g', 'or', 'g', 60, 0), pg('v-out', 'output-port', 120, 0)],
    connections: [
      { id: 'c1', from: iref('v-in', 'in:0'), to: iref('v-g', 'in:0') },
      { id: 'c2', from: iref('v-in', 'in:1'), to: iref('v-g', 'in:1') },
      { id: 'c3', from: iref('v-g', 'out:0'), to: iref('v-out', 'out:0') },
    ],
  }

  // A variant with a removed input port — should never match.
  const altered: CompositeDef = {
    id: 'altered', name: 'altered', kind: 'composite', uuid: 'U',
    ports: [
      { id: 'in:0', name: 'X', direction: 'input', terminal: { instanceId: 'a-in', pinId: 'in:0' } },
      { id: 'out:0', name: 'Y', direction: 'output', terminal: { instanceId: 'a-out', pinId: 'out:0' } },
    ],
    instances: [pg('a-in', 'input-port', 0, 0), pg('a-out', 'output-port', 60, 0)],
    connections: [],
  }

  // A variant with renamed ports (same ids/order/count) — should match, names overwritten.
  const renamed: CompositeDef = {
    id: 'renamed', name: 'renamed', kind: 'composite', uuid: 'U',
    ports: [
      { id: 'in:0', name: 'X', direction: 'input', terminal: { instanceId: 'r-in', pinId: 'in:0' }, inverted: true },
      { id: 'in:1', name: 'Z', direction: 'input', terminal: { instanceId: 'r-in', pinId: 'in:1' } },
      { id: 'out:0', name: 'W', direction: 'output', terminal: { instanceId: 'r-out', pinId: 'out:0' } },
    ],
    instances: [pg('r-in', 'input-port', 0, 0), gate('r-g', 'or', 'g', 60, 0), pg('r-out', 'output-port', 120, 0)],
    connections: [
      { id: 'c1', from: iref('r-in', 'in:0'), to: iref('r-g', 'in:0') },
      { id: 'c2', from: iref('r-in', 'in:1'), to: iref('r-g', 'in:1') },
      { id: 'c3', from: iref('r-g', 'out:0'), to: iref('r-out', 'out:0') },
    ],
  }

  // An out-of-scope variant living inside an unrelated library template.
  const v2: CompositeDef = { id: 'v2', name: 'v2', kind: 'composite', uuid: 'U', ports: [], instances: [], connections: [] }
  const other: CompositeDef = {
    id: 'other', name: 'other', kind: 'composite', uuid: 'O', ports: [],
    instances: [{ id: 'x', name: 'x', def: v2, pos: { x: 0, y: 0 } }],
    connections: [],
  }

  const main: CompositeDef = {
    id: 'main', name: 'main', kind: 'composite', uuid: 'M', ports: [],
    instances: [
      { id: 'i', name: 'i', def: v, pos: { x: 0, y: 0 } },
      { id: 'a', name: 'a', def: altered, pos: { x: 100, y: 0 } },
      { id: 'r', name: 'r', def: renamed, pos: { x: 200, y: 0 } },
    ],
    connections: [],
  }

  return { version: 2, root: main, library: { tpl: library['tpl'], other } }
}

const liveOf = (result: Design, instanceId: string): CompositeDef =>
  result.root.instances.find((i) => i.id === instanceId)!.def as CompositeDef

describe('scopeDefIds', () => {
  it('collects the current def and everything reachable through its instances', () => {
    const design = makeApplyDesign()
    const scope = scopeDefIds(design.root)
    expect(scope.has('main')).toBe(true)
    expect(scope.has('v')).toBe(true)
    expect(scope.has('altered')).toBe(true)
    expect(scope.has('renamed')).toBe(true)
    expect(scope.has('other')).toBe(false)
    expect(scope.has('v2')).toBe(false)
  })
})

describe('applyTemplate', () => {
  it('replaces internals of matching in-scope variants, preserving interface + inversion', () => {
    const design = makeApplyDesign()
    const scope = scopeDefIds(design.root)
    const { design: result, updated } = applyTemplate(design, 'tpl', scope)

    expect(updated).toBe(2)

    const v = liveOf(result, 'i')
    // Internals replaced: the OR gate becomes the template's AND.
    const g = v.instances.find((i) => i.name === 'g')!
    expect(g.def.kind === 'fork' && g.def.primitive).toBe('and')

    // Interface ids/order preserved, terminal re-pointed to the new internals.
    expect(v.ports.map((p) => p.id)).toEqual(['in:0', 'in:1', 'out:0'])
    expect(v.ports.find((p) => p.id === 'out:0')!.terminal).toEqual({ instanceId: 't-out', pinId: 'out:0' })
    // Inversion preserved from the variant (not reset by the template).
    expect(v.ports.find((p) => p.id === 'in:0')!.inverted).toBe(true)
    // Template name propagates.
    expect(v.name).toBe('tpl')

    // The altered variant (removed input) is left untouched.
    expect(liveOf(result, 'a').instances.some((i) => i.id === 'a-in')).toBe(true)
    // The out-of-scope variant is untouched.
    expect((result.library['other'].instances.find((i) => i.id === 'x')!.def as CompositeDef).instances).toEqual([])
  })

  it('matches renamed ports and overwrites their names from the template', () => {
    const design = makeApplyDesign()
    const scope = scopeDefIds(design.root)
    const { design: result } = applyTemplate(design, 'tpl', scope)

    const r = liveOf(result, 'r')
    expect(r.ports.map((p) => p.name)).toEqual(['A', 'B', 'Y'])
    expect(r.ports.map((p) => p.id)).toEqual(['in:0', 'in:1', 'out:0'])
    expect(r.ports.find((p) => p.id === 'in:0')!.inverted).toBe(true)
  })

  it('updates nothing when no variant matches or is in scope', () => {
    const design = makeApplyDesign()
    const scope = new Set(['main'])
    const { updated } = applyTemplate(design, 'tpl', scope)
    expect(updated).toBe(0)
  })
})
