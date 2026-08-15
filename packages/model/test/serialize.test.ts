import { describe, expect, it } from 'vitest'
import type { Design } from '../src/types'
import { primitiveDef } from '../src/primitives'
import { parseDesign, serializeDesign } from '../src/serialize'

function makeDesign(): Design {
  const defs: Record<string, Design['defs'][string]> = {
    and: primitiveDef('and'),
    not: primitiveDef('not'),
  }
  defs['main'] = {
    id: 'main',
    name: 'main',
    kind: 'composite',
    ports: [],
    instances: [
      { id: 'a1', name: 'a1', defId: 'and', pos: { x: 0, y: 0 } },
      { id: 'n1', name: 'n1', defId: 'not', pos: { x: 100, y: 0 } },
    ],
    connections: [{ id: 'c1', from: { instanceId: 'a1', portId: 'out:0' }, to: { instanceId: 'n1', portId: 'in:0' } }],
  }
  return { version: 1, root: 'main', defs }
}

describe('serializeDesign / parseDesign', () => {
  it('round-trips a design verbatim', () => {
    const design = makeDesign()
    expect(parseDesign(serializeDesign(design))).toEqual(design)
  })

  it('rejects malformed JSON', () => {
    expect(() => parseDesign('{ not json')).toThrow()
  })

  it('rejects JSON that is not a design', () => {
    expect(() => parseDesign('null')).toThrow()
    expect(() => parseDesign('42')).toThrow()
    expect(() => parseDesign('[]')).toThrow()
  })

  it('rejects a design missing its root def', () => {
    const design = makeDesign()
    const bad = JSON.parse(JSON.stringify(design))
    bad.root = 'nope'
    expect(() => parseDesign(JSON.stringify(bad))).toThrow()
  })

  it('rejects a design with a malformed def', () => {
    const design = makeDesign()
    const bad = JSON.parse(JSON.stringify(design))
    delete bad.defs['and'].kind
    expect(() => parseDesign(JSON.stringify(bad))).toThrow()
  })
})
