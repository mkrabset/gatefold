import { describe, expect, it } from 'vitest'
import type { ComponentDef, Design } from '@gatefold/model'
import { inputPortDef, outputPortDef, primitiveDef } from '@gatefold/model'
import { applyTemplate, scopeDefIds } from './apply'

const iref = (instanceId: string, portId: string) => ({ instanceId, portId })

function makeApplyDesign(): Design {
  const defs: Record<string, ComponentDef> = {
    and: primitiveDef('and'),
    or: primitiveDef('or'),
    'input-port': inputPortDef(),
    'output-port': outputPortDef(),
  }

  defs['tpl'] = {
    id: 'tpl', name: 'tpl', kind: 'composite', uuid: 'U',
    ports: [
      { id: 'in:0', name: 'A', direction: 'input', terminal: { instanceId: 't-in', pinId: 'in:0' } },
      { id: 'in:1', name: 'B', direction: 'input', terminal: { instanceId: 't-in', pinId: 'in:1' } },
      { id: 'out:0', name: 'Y', direction: 'output', terminal: { instanceId: 't-out', pinId: 'out:0' } },
    ],
    instances: [
      { id: 't-in', name: '', defId: 'input-port', pos: { x: 0, y: 0 } },
      { id: 't-g', name: 'g', defId: 'and', pos: { x: 60, y: 0 } },
      { id: 't-out', name: '', defId: 'output-port', pos: { x: 120, y: 0 } },
    ],
    connections: [
      { id: 'c1', from: iref('t-in', 'in:0'), to: iref('t-g', 'in:0') },
      { id: 'c2', from: iref('t-in', 'in:1'), to: iref('t-g', 'in:1') },
      { id: 'c3', from: iref('t-g', 'out:0'), to: iref('t-out', 'out:0') },
    ],
  }

  // A matching variant: same interface, but OR internals and an inverted input.
  defs['v'] = {
    id: 'v', name: 'v', kind: 'composite', variant: true, uuid: 'U',
    ports: [
      { id: 'in:0', name: 'A', direction: 'input', terminal: { instanceId: 'v-in', pinId: 'in:0' }, inverted: true },
      { id: 'in:1', name: 'B', direction: 'input', terminal: { instanceId: 'v-in', pinId: 'in:1' } },
      { id: 'out:0', name: 'Y', direction: 'output', terminal: { instanceId: 'v-out', pinId: 'out:0' } },
    ],
    instances: [
      { id: 'v-in', name: '', defId: 'input-port', pos: { x: 0, y: 0 } },
      { id: 'v-g', name: 'g', defId: 'or', pos: { x: 60, y: 0 } },
      { id: 'v-out', name: '', defId: 'output-port', pos: { x: 120, y: 0 } },
    ],
    connections: [
      { id: 'c1', from: iref('v-in', 'in:0'), to: iref('v-g', 'in:0') },
      { id: 'c2', from: iref('v-in', 'in:1'), to: iref('v-g', 'in:1') },
      { id: 'c3', from: iref('v-g', 'out:0'), to: iref('v-out', 'out:0') },
    ],
  }

  // A variant with a removed input port (only 1 of the template's 2) — should never match.
  defs['altered'] = {
    id: 'altered', name: 'altered', kind: 'composite', variant: true, uuid: 'U',
    ports: [
      { id: 'in:0', name: 'X', direction: 'input', terminal: { instanceId: 'a-in', pinId: 'in:0' } },
      { id: 'out:0', name: 'Y', direction: 'output', terminal: { instanceId: 'a-out', pinId: 'out:0' } },
    ],
    instances: [
      { id: 'a-in', name: '', defId: 'input-port', pos: { x: 0, y: 0 } },
      { id: 'a-out', name: '', defId: 'output-port', pos: { x: 60, y: 0 } },
    ],
    connections: [],
  }

  // A variant with renamed ports (same ids/order/count) — should match, names overwritten.
  defs['renamed'] = {
    id: 'renamed', name: 'renamed', kind: 'composite', variant: true, uuid: 'U',
    ports: [
      { id: 'in:0', name: 'X', direction: 'input', terminal: { instanceId: 'r-in', pinId: 'in:0' }, inverted: true },
      { id: 'in:1', name: 'Z', direction: 'input', terminal: { instanceId: 'r-in', pinId: 'in:1' } },
      { id: 'out:0', name: 'W', direction: 'output', terminal: { instanceId: 'r-out', pinId: 'out:0' } },
    ],
    instances: [
      { id: 'r-in', name: '', defId: 'input-port', pos: { x: 0, y: 0 } },
      { id: 'r-g', name: 'g', defId: 'or', pos: { x: 60, y: 0 } },
      { id: 'r-out', name: '', defId: 'output-port', pos: { x: 120, y: 0 } },
    ],
    connections: [
      { id: 'c1', from: iref('r-in', 'in:0'), to: iref('r-g', 'in:0') },
      { id: 'c2', from: iref('r-in', 'in:1'), to: iref('r-g', 'in:1') },
      { id: 'c3', from: iref('r-g', 'out:0'), to: iref('r-out', 'out:0') },
    ],
  }

  // An out-of-scope variant living in a def `main` does not reference.
  defs['v2'] = {
    id: 'v2', name: 'v2', kind: 'composite', variant: true, uuid: 'U',
    ports: [],
    instances: [],
    connections: [],
  }
  defs['other'] = {
    id: 'other', name: 'other', kind: 'composite', uuid: 'O', ports: [],
    instances: [{ id: 'x', name: 'x', defId: 'v2', pos: { x: 0, y: 0 } }],
    connections: [],
  }

  defs['main'] = {
    id: 'main', name: 'main', kind: 'composite', uuid: 'M', ports: [],
    instances: [
      { id: 'i', name: 'i', defId: 'v', pos: { x: 0, y: 0 } },
      { id: 'a', name: 'a', defId: 'altered', pos: { x: 100, y: 0 } },
      { id: 'r', name: 'r', defId: 'renamed', pos: { x: 200, y: 0 } },
    ],
    connections: [],
  }

  return { version: 1, root: 'main', defs }
}

describe('scopeDefIds', () => {
  it('collects the current def and everything reachable through its instances', () => {
    const design = makeApplyDesign()
    const scope = scopeDefIds(design, 'main')
    expect(scope.has('main')).toBe(true)
    expect(scope.has('v')).toBe(true)
    expect(scope.has('altered')).toBe(true)
    expect(scope.has('or')).toBe(true)
    expect(scope.has('other')).toBe(false)
    expect(scope.has('v2')).toBe(false)
  })
})

describe('applyTemplate', () => {
  it('replaces internals of matching in-scope variants, preserving interface + inversion', () => {
    const design = makeApplyDesign()
    const scope = scopeDefIds(design, 'main')
    const { design: result, updated } = applyTemplate(design, 'tpl', scope)

    expect(updated).toBe(2)

    const v = result.defs['v']
    // Internals replaced: the OR gate becomes the template's AND (fresh variant copy).
    const g = v.instances!.find((i) => i.name === 'g')!
    expect(g.defId).not.toBe('or')
    expect(result.defs[g.defId].primitive).toBe('and')

    // Interface ids/order preserved, terminal re-pointed to the new internals.
    expect(v.ports.map((p) => p.id)).toEqual(['in:0', 'in:1', 'out:0'])
    expect(v.ports.find((p) => p.id === 'out:0')!.terminal).toEqual({ instanceId: 't-out', pinId: 'out:0' })
    // Inversion preserved from the variant (not reset by the template).
    expect(v.ports.find((p) => p.id === 'in:0')!.inverted).toBe(true)
    // Template name propagates.
    expect(v.name).toBe('tpl')

    // The altered variant (removed input) is left untouched.
    expect(result.defs['altered'].instances!.some((i) => i.id === 'a-in')).toBe(true)
    // The out-of-scope variant is untouched.
    expect(result.defs['v2'].instances).toEqual([])
  })

  it('matches renamed ports and overwrites their names from the template', () => {
    const design = makeApplyDesign()
    const scope = scopeDefIds(design, 'main')
    const { design: result } = applyTemplate(design, 'tpl', scope)

    const r = result.defs['renamed']
    // Names overwritten with the template's; ids/order kept.
    expect(r.ports.map((p) => p.name)).toEqual(['A', 'B', 'Y'])
    expect(r.ports.map((p) => p.id)).toEqual(['in:0', 'in:1', 'out:0'])
    // Inversion still preserved from the variant.
    expect(r.ports.find((p) => p.id === 'in:0')!.inverted).toBe(true)
  })

  it('updates nothing when no variant matches or is in scope', () => {
    const design = makeApplyDesign()
    const scope = new Set(['main'])
    const { updated } = applyTemplate(design, 'tpl', scope)
    expect(updated).toBe(0)
  })
})
