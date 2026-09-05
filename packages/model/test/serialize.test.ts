import { describe, expect, it } from 'vitest'
import type { ComponentDef, CompositeDef, Design } from '../src/types'
import { inputPortDef, outputPortDef, primitiveDef, withBuiltinPrimitives } from '../src/primitives'
import { parseDesign, sanitizeDesign, serializeDesign, stripBuiltinPrimitives } from '../src/serialize'

const mainDef = (design: Design): CompositeDef => design.defs['main'] as CompositeDef

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
  return { version: 1, root: 'main', library: {}, defs }
}

describe('serializeDesign / parseDesign', () => {
  it('omits canonical built-in primitives but keeps the composite intact', () => {
    const design = makeDesign()
    const parsed = parseDesign(serializeDesign(design))
    expect(parsed.defs['and']).toBeUndefined()
    expect(parsed.defs['not']).toBeUndefined()
    expect(parsed.defs['main']).toBeDefined()
    // The composite's own contents round-trip intact.
    expect(parsed.defs['main']).toEqual(design.defs['main'])
    // Built-ins are regenerated on load.
    expect(withBuiltinPrimitives(parsed).defs['and']).toEqual(primitiveDef('and'))
  })

  it('keeps referenced primitive forks', () => {
    const design = makeDesign()
    design.defs['and~1'] = { ...primitiveDef('and'), id: 'and~1' }
    mainDef(design).instances!.push({ id: 'a2', name: 'a2', defId: 'and~1', pos: { x: 0, y: 0 } })
    const parsed = parseDesign(serializeDesign(design))
    expect(parsed.defs['and~1']).toBeDefined()
    expect(parsed.defs['and']).toBeUndefined()
  })

  it('drops unreferenced defs (GC on save)', () => {
    const design = makeDesign()
    design.defs['and~orphan'] = { ...primitiveDef('and'), id: 'and~orphan' }
    const parsed = parseDesign(serializeDesign(design))
    expect(parsed.defs['and~orphan']).toBeUndefined()
  })

  it('rounds instance coordinates to 2 decimals', () => {
    const design = makeDesign()
    mainDef(design).instances![0].pos = { x: 1.23456789, y: -2.9999999 }
    const parsed = parseDesign(serializeDesign(design))
    expect(mainDef(parsed).instances![0].pos).toEqual({ x: 1.23, y: -3 })
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

describe('stripBuiltinPrimitives', () => {
  it('removes only canonical built-in primitive defs', () => {
    const design = makeDesign()
    design.defs['and~1'] = { ...primitiveDef('and'), id: 'and~1' }
    const stripped = stripBuiltinPrimitives(design)
    expect(stripped.defs['and']).toBeUndefined()
    expect(stripped.defs['not']).toBeUndefined()
    expect(stripped.defs['and~1']).toBeDefined()
    expect(stripped.defs['main']).toBeDefined()
  })
})

describe('parseDesign (legacy migration)', () => {
  it('splits a legacy flat defs map (with `variant`) into library + defs', () => {
    const legacy = {
      version: 1,
      root: 'main',
      defs: {
        and: primitiveDef('and'),
        'input-port': inputPortDef(),
        'output-port': outputPortDef(),
        tpl: { id: 'tpl', name: 'tpl', kind: 'composite', uuid: 'U', ports: [], instances: [], connections: [] },
        'tpl~1': { id: 'tpl~1', name: 'tpl', kind: 'composite', variant: true, uuid: 'U', ports: [], instances: [], connections: [] },
        main: {
          id: 'main', name: 'main', kind: 'composite', ports: [],
          instances: [{ id: 'a', name: 'a', defId: 'tpl~1', pos: { x: 0, y: 0 } }],
          connections: [],
        },
      },
    }

    const design = parseDesign(JSON.stringify(legacy))
    // Templates → library, live copies + root + built-ins → defs, `variant` dropped.
    expect(design.library['tpl']).toBeDefined()
    expect((design.library['tpl'] as ComponentDef & { variant?: boolean }).variant).toBeUndefined()
    expect(design.defs['tpl~1']).toBeDefined()
    expect(design.defs['main']).toBeDefined()
    // Built-ins remain in `defs` (stripped only at save time).
    expect(design.defs['and']).toBeDefined()
    // Legacy field is gone from the parsed result.
    expect((design.defs['tpl~1'] as ComponentDef & { variant?: boolean }).variant).toBeUndefined()
  })
})

describe('sanitizeDesign', () => {
  it('removes connections to missing instances and instances with missing defs', () => {
    const design = makeDesign()
    const main = mainDef(design)
    // Add a dangling connection (references an unknown instance) and a dangling
    // instance (references an unknown def).
    main.connections!.push({ id: 'c2', from: { instanceId: 'ghost', portId: 'out:0' }, to: { instanceId: 'n1', portId: 'in:0' } })
    main.instances!.push({ id: 'orphan', name: 'orphan', defId: 'missing-def', pos: { x: 0, y: 0 } })
    main.connections!.push({ id: 'c3', from: { instanceId: 'orphan', portId: 'out:0' }, to: { instanceId: 'n1', portId: 'in:0' } })

    const { design: clean, issues } = sanitizeDesign(design)
    const cleanMain = mainDef(clean)
    expect(cleanMain.instances!.map((i) => i.id)).toEqual(['a1', 'n1'])
    expect(cleanMain.connections!.map((c) => c.id)).toEqual(['c1'])
    expect(issues).toEqual([
      { type: 'dangling-instance', defId: 'main', instanceId: 'orphan', instanceName: 'orphan', missingDefId: 'missing-def' },
      { type: 'dangling-connection', defId: 'main', connectionId: 'c2', endpoint: 'from', missingInstanceId: 'ghost' },
      { type: 'dangling-connection', defId: 'main', connectionId: 'c3', endpoint: 'from', missingInstanceId: 'orphan' },
    ])
  })
})
