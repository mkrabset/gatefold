import { describe, expect, it } from 'vitest'
import type { ComponentDef, CompositeDef, Design, Instance, PrimitiveDef } from '../src/types'
import { inputPortDef, outputPortDef, primitiveDef } from '../src/primitives'
import { cloneDef } from '../src/group'
import { exportLibrary, importLibrary, deleteTemplate, parseLibrary, serializeLibrary } from '../src/library'
import { buildProject } from '../src/serialize'

const inst = (id: string, defId: string, x = 0, y = 0): Instance => ({ id, name: id, defId, pos: { x, y } })

function makeDesign(): Design {
  const defs: Record<string, ComponentDef> = {
    and: primitiveDef('and'),
    or: primitiveDef('or'),
    'input-port': inputPortDef(),
    'output-port': outputPortDef(),
  }
  const bar: CompositeDef = {
    id: 'bar',
    name: 'bar',
    kind: 'composite',
    ports: [],
    uuid: 'uuid-bar',
    instances: [inst('o1', 'or')],
    connections: [],
    category: 'Logic',
  }
  // `bar~x` is an embedded copy of `bar` (soft link: shared `uuid`).
  const barCopy: CompositeDef = { ...cloneDef(bar), id: 'bar~x' } as CompositeDef
  const foo: CompositeDef = {
    id: 'foo',
    name: 'foo',
    kind: 'composite',
    ports: [],
    uuid: 'uuid-foo',
    instances: [inst('a1', 'and'), inst('b1', 'bar~x', 100)],
    connections: [],
  }
  defs['main'] = {
    id: 'main',
    name: 'main',
    kind: 'composite',
    ports: [],
    instances: [inst('f1', 'foo~1')],
    connections: [],
  }
  // `foo~1` is a live copy of `foo` in the content tree.
  defs['foo~1'] = { ...cloneDef(foo), id: 'foo~1' } as CompositeDef
  return { version: 1, root: 'main', library: { bar, 'bar~x': barCopy, foo }, defs }
}

describe('exportLibrary', () => {
  it('exports the library only: templates + embedded copies, never the content tree', () => {
    const lib = exportLibrary(makeDesign())

    const ids = Object.keys(lib.library).sort()
    expect(ids).toEqual(['bar', 'bar~x', 'foo'])

    // No built-ins, port groups, root, or live copies.
    expect(lib.library['main']).toBeUndefined()
    expect(lib.library['foo~1']).toBeUndefined()
    expect(lib.library['and']).toBeUndefined()
  })

  it('is byte-identical to the `library` field of Save JSON (shared code path)', () => {
    const design = makeDesign()
    expect(exportLibrary(design).library).toEqual(buildProject(design).library)
  })

  it('round-trips through serializeLibrary / parseLibrary', () => {
    const design = makeDesign()
    expect(parseLibrary(serializeLibrary(exportLibrary(design)))).toEqual(exportLibrary(design))
  })

  it('preserves a template category through export and import', () => {
    const design = makeDesign()
    const lib = exportLibrary(design)
    expect((lib.library['bar'] as CompositeDef).category).toBe('Logic')

    const target: Design = {
      version: 1,
      root: 'main',
      library: {},
      defs: {
        and: primitiveDef('and'),
        or: primitiveDef('or'),
        'input-port': inputPortDef(),
        'output-port': outputPortDef(),
        main: { id: 'main', name: 'main', kind: 'composite', ports: [], instances: [], connections: [] },
      },
    }
    const result = importLibrary(target, lib)
    expect((result.library['bar'] as CompositeDef).category).toBe('Logic')
  })

  it('rejects invalid library JSON', () => {
    expect(() => parseLibrary('nope')).toThrow()
    expect(() => parseLibrary('{"version":1,"library":{"x":{}}}')).toThrow()
  })
})

describe('importLibrary', () => {
  it('merges components into the library with fresh ids and names', () => {
    const design = makeDesign()
    const lib = exportLibrary(design)

    const target: Design = {
      version: 1,
      root: 'main',
      library: {},
      defs: {
        and: primitiveDef('and'),
        or: primitiveDef('or'),
        'input-port': inputPortDef(),
        'output-port': outputPortDef(),
        main: { id: 'main', name: 'main', kind: 'composite', ports: [], instances: [], connections: [] },
      },
    }

    const result = importLibrary(target, lib)
    expect(result.library['foo']).toBeDefined()
    expect(result.library['bar']).toBeDefined()
    // Embedded copy comes along, with its lineage soft-link preserved (same new uuid).
    const foo = result.library['foo'] as CompositeDef
    const barCopyId = foo.instances!.find((i) => i.id === 'b1')!.defId
    const barCopy = result.library[barCopyId] as CompositeDef
    expect(barCopy.uuid).toBe((result.library['bar'] as CompositeDef).uuid)
    // Internal references resolve within the imported library / built-ins.
    expect((result.library['bar'] as CompositeDef).instances!.find((i) => i.id === 'o1')!.defId).toBe('or')
    expect(foo.instances!.find((i) => i.id === 'a1')!.defId).toBe('and')
  })

  it('renames on collision instead of overwriting', () => {
    const design = makeDesign()
    const lib = exportLibrary(design)

    const first = importLibrary(design, lib)
    const second = importLibrary(first, lib)

    // Original components survive, and the second import gets suffixed ids/names.
    expect(second.library['foo']).toBeDefined()
    expect(second.library['foo~2']).toBeDefined()
    expect((second.library['foo~2'] as CompositeDef).name).toBe('foo~2')
  })

  it('preserves a custom primitive fork in the library (custom-arity fan-in)', () => {
    const fanIn4: PrimitiveDef = {
      id: 'fan-in~4',
      name: 'FAN-IN',
      kind: 'primitive',
      primitive: 'fan-in',
      ports: [
        { id: 'in:0', name: 'A', direction: 'input' },
        { id: 'in:1', name: 'B', direction: 'input' },
        { id: 'in:2', name: 'C', direction: 'input' },
        { id: 'in:3', name: 'D', direction: 'input' },
        { id: 'out:0', name: 'BUS', direction: 'output' },
      ],
    }
    const design: Design = {
      version: 1,
      root: 'main',
      library: {
        'fan-in~4': fanIn4,
        foo: {
          id: 'foo',
          name: 'foo',
          kind: 'composite',
          ports: [],
          instances: [inst('f1', 'fan-in~4')],
          connections: [],
        },
      },
      defs: {
        'fan-in': primitiveDef('fan-in'),
        'input-port': inputPortDef(),
        'output-port': outputPortDef(),
        main: { id: 'main', name: 'main', kind: 'composite', ports: [], instances: [inst('x1', 'foo~1')], connections: [] },
        'foo~1': {
          id: 'foo~1',
          name: 'foo',
          kind: 'composite',
          ports: [],
          instances: [inst('f1', 'fan-in~4')],
          connections: [],
        },
      },
    }

    const lib = exportLibrary(design)
    const fanInComponent = Object.values(lib.library).find((c) => c.kind === 'primitive' && c.primitive === 'fan-in')
    expect(fanInComponent).toBeDefined()
    expect((fanInComponent as PrimitiveDef).ports.filter((p) => p.direction === 'input')).toHaveLength(4)

    const target: Design = {
      version: 1,
      root: 'main',
      library: {},
      defs: {
        'fan-in': primitiveDef('fan-in'),
        'input-port': inputPortDef(),
        'output-port': outputPortDef(),
        main: { id: 'main', name: 'main', kind: 'composite', ports: [], instances: [], connections: [] },
      },
    }
    const result = importLibrary(target, lib)
    const importedFoo = result.library['foo'] as CompositeDef
    const fanInId = importedFoo.instances!.find((i) => i.id === 'f1')!.defId
    const importedFan = result.library[fanInId] as PrimitiveDef
    expect(importedFan.primitive).toBe('fan-in')
    expect(importedFan.ports.filter((p) => p.direction === 'input')).toHaveLength(4)
  })
})

describe('deleteTemplate', () => {
  it('deletes a template together with its embedded parts', () => {
    const design = makeDesign()
    const result = deleteTemplate(design, 'foo')

    // The template and its embedded copy are gone; the origin it was copied from stays.
    expect(result.library['foo']).toBeUndefined()
    expect(result.library['bar~x']).toBeUndefined()
    expect(result.library['bar']).toBeDefined()
  })

  it('clears the uuid soft link on live copies but keeps the origin\'s uuid', () => {
    const design = makeDesign()
    const result = deleteTemplate(design, 'foo')

    // The live copy (content tree) survives, but its lineage link is broken.
    expect(result.defs['foo~1']).toBeDefined()
    expect((result.defs['foo~1'] as CompositeDef).uuid).toBeUndefined()
    // The origin's own uuid is untouched.
    expect((result.library['bar'] as CompositeDef).uuid).toBe('uuid-bar')
  })

  it('removes embedded primitive forks with their template', () => {
    const design: Design = {
      version: 1,
      root: 'main',
      library: {
        'fan-in~4': {
          id: 'fan-in~4',
          name: 'FAN-IN',
          kind: 'primitive',
          primitive: 'fan-in',
          ports: [
            { id: 'in:0', name: 'A', direction: 'input' },
            { id: 'in:1', name: 'B', direction: 'input' },
            { id: 'in:2', name: 'C', direction: 'input' },
            { id: 'in:3', name: 'D', direction: 'input' },
            { id: 'out:0', name: 'BUS', direction: 'output' },
          ],
        },
        foo: {
          id: 'foo',
          name: 'foo',
          kind: 'composite',
          ports: [],
          instances: [inst('f1', 'fan-in~4')],
          connections: [],
        },
      },
      defs: {
        'fan-in': primitiveDef('fan-in'),
        'input-port': inputPortDef(),
        'output-port': outputPortDef(),
        main: { id: 'main', name: 'main', kind: 'composite', ports: [], instances: [], connections: [] },
      },
    }

    const result = deleteTemplate(design, 'foo')
    expect(result.library['foo']).toBeUndefined()
    expect(result.library['fan-in~4']).toBeUndefined()
    // The canonical built-in fan-in (in defs) is untouched.
    expect(result.defs['fan-in']).toBeDefined()
  })

  it('returns the design unchanged when the template is missing', () => {
    const design = makeDesign()
    expect(deleteTemplate(design, 'nope')).toEqual(design)
  })
})
