import { describe, expect, it } from 'vitest'
import type { CompositeDef, Design } from '../src/types'
import { forkOf } from '../src/primitives'
import { parseDesign, sanitizeDesign, serializeDesign } from '../src/serialize'

const AND_PORTS = [
  { id: 'in:0', name: 'A', direction: 'input' as const },
  { id: 'in:1', name: 'B', direction: 'input' as const },
  { id: 'out:0', name: 'Y', direction: 'output' as const },
]

function makeDesign(): Design {
  const main: CompositeDef = {
    id: 'main',
    name: 'main',
    kind: 'composite',
    ports: [],
    instances: [
      { id: 'a1', name: 'a1', def: forkOf('and'), pos: { x: 0, y: 0 } },
      { id: 'n1', name: 'n1', def: forkOf('not'), pos: { x: 100, y: 0 } },
    ],
    connections: [{ id: 'c1', from: { instanceId: 'a1', portId: 'out:0' }, to: { instanceId: 'n1', portId: 'in:0' } }],
  }
  return { version: 2, root: main, library: {} }
}

describe('serializeDesign / parseDesign', () => {
  it('round-trips a nested design intact', () => {
    const design = makeDesign()
    const parsed = parseDesign(serializeDesign(design))
    expect(parsed.root).toEqual(design.root)
    expect(parsed.library).toEqual({})
  })

  it('keeps primitive forks referenced by instances', () => {
    const design = makeDesign()
    design.root.instances.push({ id: 'a2', name: 'a2', def: { kind: 'fork', primitive: 'and', ports: AND_PORTS }, pos: { x: 0, y: 0 } })
    const parsed = parseDesign(serializeDesign(design))
    const fork = parsed.root.instances.find((i) => i.id === 'a2')!.def
    expect(fork).toEqual({ kind: 'fork', primitive: 'and', ports: AND_PORTS })
  })

  it('rounds instance coordinates to 2 decimals', () => {
    const design = makeDesign()
    design.root.instances[0].pos = { x: 1.23456789, y: -2.9999999 }
    const parsed = parseDesign(serializeDesign(design))
    expect(parsed.root.instances[0].pos).toEqual({ x: 1.23, y: -3 })
  })

  it('rejects malformed JSON', () => {
    expect(() => parseDesign('{ not json')).toThrow()
  })

  it('rejects JSON that is not a design', () => {
    expect(() => parseDesign('null')).toThrow()
    expect(() => parseDesign('42')).toThrow()
    expect(() => parseDesign('[]')).toThrow()
  })

  it('rejects a design whose root is not a composite', () => {
    const bad = { version: 2, root: { id: 'x', name: 'x', kind: 'primitive', primitive: 'and', ports: [] }, library: {} }
    expect(() => parseDesign(JSON.stringify(bad))).toThrow()
  })

  it('rejects a design with a malformed instance', () => {
    const design = makeDesign()
    const bad = JSON.parse(JSON.stringify(design))
    delete bad.root.instances[0].def
    expect(() => parseDesign(JSON.stringify(bad))).toThrow()
  })
})

describe('parseDesign (v1 two-part migration)', () => {
  it('migrates a v1 two-part document to the nested model', () => {
    const flat = {
      version: 1,
      root: 'main',
      library: {
        tpl: { id: 'tpl', name: 'tpl', kind: 'composite', ports: [], instances: [{ id: 'g', name: 'g', defId: 'and~1', pos: { x: 0, y: 0 } }], connections: [] },
      },
      defs: {
        'and~1': { id: 'and~1', name: 'AND', kind: 'primitive', primitive: 'and', ports: AND_PORTS },
        main: { id: 'main', name: 'main', kind: 'composite', ports: [], instances: [{ id: 'a', name: 'a', defId: 'and~1', pos: { x: 0, y: 0 } }], connections: [] },
      },
    }
    const design = parseDesign(JSON.stringify(flat))
    expect(design.version).toBe(2)
    expect(design.root.id).toBe('main')
    expect(design.root.instances[0].def).toEqual({ kind: 'fork', primitive: 'and', ports: AND_PORTS })
    expect(design.library['tpl'].instances[0].def).toEqual({ kind: 'fork', primitive: 'and', ports: AND_PORTS })
  })

  it('migrates a legacy flat-variant document to the nested model', () => {
    const legacy = {
      version: 1,
      root: 'main',
      defs: {
        and: { id: 'and', name: 'AND', kind: 'primitive', primitive: 'and', ports: AND_PORTS },
        'input-port': { id: 'input-port', name: 'input-port', kind: 'primitive', primitive: 'input-port', ports: [] },
        'output-port': { id: 'output-port', name: 'output-port', kind: 'primitive', primitive: 'output-port', ports: [] },
        tpl: { id: 'tpl', name: 'tpl', kind: 'composite', uuid: 'U', ports: [], instances: [], connections: [] },
        'tpl~1': { id: 'tpl~1', name: 'tpl', kind: 'composite', variant: true, uuid: 'U', ports: [], instances: [], connections: [] },
        main: {
          id: 'main',
          name: 'main',
          kind: 'composite',
          ports: [],
          instances: [{ id: 'a', name: 'a', defId: 'tpl~1', pos: { x: 0, y: 0 } }],
          connections: [],
        },
      },
    }
    const design = parseDesign(JSON.stringify(legacy))
    expect(design.library['tpl']).toBeDefined()
    expect(design.root.id).toBe('main')
    expect(design.root.instances[0].def).toEqual(expect.objectContaining({ kind: 'composite', id: 'tpl~1' }))
    // The canonical built-in primitive becomes a shared builtin reference.
    expect(design.library['tpl'].kind).toBe('composite')
  })
})

describe('sanitizeDesign', () => {
  it('removes connections to missing instances', () => {
    const design = makeDesign()
    design.root.connections.push({ id: 'c2', from: { instanceId: 'ghost', portId: 'out:0' }, to: { instanceId: 'n1', portId: 'in:0' } })

    const { design: clean, issues } = sanitizeDesign(design)
    expect(clean.root.connections.map((c) => c.id)).toEqual(['c1'])
    expect(issues).toEqual([
      { type: 'dangling-connection', defId: 'main', connectionId: 'c2', endpoint: 'from', missingInstanceId: 'ghost' },
    ])
  })
})
