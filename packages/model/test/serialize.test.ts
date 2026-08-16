import { describe, expect, it } from 'vitest'
import type { Design } from '../src/types'
import { primitiveDef } from '../src/primitives'
import { parseDesign, sanitizeDesign, serializeDesign } from '../src/serialize'

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

describe('sanitizeDesign', () => {
  it('removes connections to missing instances and instances with missing defs', () => {
    const design = makeDesign()
    // Add a dangling connection (references an unknown instance) and a dangling
    // instance (references an unknown def).
    design.defs['main'].connections!.push({ id: 'c2', from: { instanceId: 'ghost', portId: 'out:0' }, to: { instanceId: 'n1', portId: 'in:0' } })
    design.defs['main'].instances!.push({ id: 'orphan', name: 'orphan', defId: 'missing-def', pos: { x: 0, y: 0 } })
    design.defs['main'].connections!.push({ id: 'c3', from: { instanceId: 'orphan', portId: 'out:0' }, to: { instanceId: 'n1', portId: 'in:0' } })

    const { design: clean, issues } = sanitizeDesign(design)
    const main = clean.defs['main']
    expect(main.instances!.map((i) => i.id)).toEqual(['a1', 'n1'])
    expect(main.connections!.map((c) => c.id)).toEqual(['c1'])
    expect(issues).toEqual([
      { type: 'dangling-instance', defId: 'main', instanceId: 'orphan', instanceName: 'orphan', missingDefId: 'missing-def' },
      { type: 'dangling-connection', defId: 'main', connectionId: 'c2', endpoint: 'from', missingInstanceId: 'ghost' },
      { type: 'dangling-connection', defId: 'main', connectionId: 'c3', endpoint: 'from', missingInstanceId: 'orphan' },
    ])
  })
})
