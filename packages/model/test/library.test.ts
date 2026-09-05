import { describe, expect, it } from 'vitest'
import type { ChildDef, CompositeDef, Design, Instance } from '../src/types'
import { childPorts, forkOf } from '../src/primitives'
import { exportLibrary, importLibrary, deleteTemplate, parseLibrary, serializeLibrary } from '../src/library'
import { buildProject } from '../src/serialize'

const inst = (id: string, def: ChildDef, x = 0, y = 0): Instance => ({ id, name: id, def, pos: { x, y } })

function emptyRoot(): CompositeDef {
  return { id: 'main', name: 'main', kind: 'composite', ports: [], instances: [], connections: [] }
}

function makeDesign(): Design {
  const bar: CompositeDef = {
    id: 'bar',
    name: 'bar',
    kind: 'composite',
    ports: [],
    uuid: 'uuid-bar',
    category: 'Logic',
    instances: [inst('o1', forkOf('or'))],
    connections: [],
  }
  // Embedded copy of `bar` (soft link: shared uuid), owned inline by `foo`.
  const barCopy: CompositeDef = {
    id: 'bar~x',
    name: 'bar',
    kind: 'composite',
    ports: [],
    uuid: 'uuid-bar',
    instances: [inst('o1', forkOf('or'))],
    connections: [],
  }
  const foo: CompositeDef = {
    id: 'foo',
    name: 'foo',
    kind: 'composite',
    ports: [],
    uuid: 'uuid-foo',
    instances: [inst('a1', forkOf('and')), inst('b1', barCopy, 100)],
    connections: [],
  }
  // Live copy of `foo` in the content tree.
  const fooLive: CompositeDef = {
    id: 'foo~1',
    name: 'foo',
    kind: 'composite',
    ports: [],
    uuid: 'uuid-foo',
    instances: [inst('a1', forkOf('and')), inst('b1', { ...barCopy, id: 'bar~y' }, 100)],
    connections: [],
  }
  return { version: 2, root: { ...emptyRoot(), instances: [inst('f1', fooLive)] }, library: { bar, foo } }
}

describe('exportLibrary', () => {
  it('exports the library only: templates (embedded copies are inline), never the content tree', () => {
    const lib = exportLibrary(makeDesign())

    const ids = Object.keys(lib.library).sort()
    expect(ids).toEqual(['bar', 'foo'])

    // No root or live copies.
    expect(lib.library['main']).toBeUndefined()
    expect(lib.library['foo~1']).toBeUndefined()
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

    const target: Design = { version: 2, root: emptyRoot(), library: {} }
    const result = importLibrary(target, lib)
    expect(result.library['bar'].category).toBe('Logic')
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

    const target: Design = { version: 2, root: emptyRoot(), library: {} }
    const result = importLibrary(target, lib)
    expect(result.library['foo']).toBeDefined()
    expect(result.library['bar']).toBeDefined()

    // The embedded copy comes along inline, with its lineage soft-link preserved
    // (same fresh uuid as the origin template).
    const foo = result.library['foo']
    const b1 = foo.instances.find((i) => i.id === 'b1')!
    expect(b1.def.kind === 'composite' && b1.def.uuid).toBe(result.library['bar'].uuid)
    // Internal primitive references are inline forks.
    expect(childPorts(foo.instances.find((i) => i.id === 'a1')!.def).map((p) => p.id)).toEqual(['in:0', 'in:1', 'out:0'])
  })

  it('renames on collision instead of overwriting', () => {
    const design = makeDesign()
    const lib = exportLibrary(design)

    const first = importLibrary(design, lib)
    const second = importLibrary(first, lib)

    expect(second.library['foo']).toBeDefined()
    expect(second.library['foo~2']).toBeDefined()
    expect(second.library['foo~2'].name).toBe('foo~2')
  })

  it('preserves a custom primitive fork in the library (custom-arity fan-in)', () => {
    const fanIn4: ChildDef = {
      kind: 'fork',
      primitive: 'fan-in',
      ports: [
        { id: 'in:0', name: 'A', direction: 'input' },
        { id: 'in:1', name: 'B', direction: 'input' },
        { id: 'in:2', name: 'C', direction: 'input' },
        { id: 'in:3', name: 'D', direction: 'input' },
        { id: 'out:0', name: 'BUS', direction: 'output' },
      ],
    }
    const foo: CompositeDef = {
      id: 'foo',
      name: 'foo',
      kind: 'composite',
      ports: [],
      instances: [inst('f1', fanIn4)],
      connections: [],
    }
    const design: Design = { version: 2, root: emptyRoot(), library: { foo } }

    const lib = exportLibrary(design)
    const fanInInst = lib.library['foo'].instances[0]
    expect(fanInInst.def.kind).toBe('fork')
    expect(childPorts(fanInInst.def).filter((p) => p.direction === 'input')).toHaveLength(4)

    const target: Design = { version: 2, root: emptyRoot(), library: {} }
    const result = importLibrary(target, lib)
    const importedFan = result.library['foo'].instances[0].def
    expect(importedFan.kind).toBe('fork')
    expect(childPorts(importedFan).filter((p) => p.direction === 'input')).toHaveLength(4)
  })
})

describe('deleteTemplate', () => {
  it('deletes a template together with its embedded parts', () => {
    const design = makeDesign()
    const result = deleteTemplate(design, 'foo')

    expect(result.library['foo']).toBeUndefined()
    expect(result.library['bar']).toBeDefined()
  })

  it("clears the uuid soft link on live copies but keeps the origin's uuid", () => {
    const design = makeDesign()
    const result = deleteTemplate(design, 'foo')

    // The live copy (content tree) survives, but its lineage link is broken.
    const fooLive = result.root.instances.find((i) => i.id === 'f1')!.def as CompositeDef
    expect(fooLive.id).toBe('foo~1')
    expect(fooLive.uuid).toBeUndefined()
    // The origin's own uuid is untouched.
    expect(result.library['bar'].uuid).toBe('uuid-bar')
  })

  it('removes embedded primitive forks with their template', () => {
    const fanIn4: ChildDef = {
      kind: 'fork',
      primitive: 'fan-in',
      ports: [
        { id: 'in:0', name: 'A', direction: 'input' },
        { id: 'in:1', name: 'B', direction: 'input' },
        { id: 'in:2', name: 'C', direction: 'input' },
        { id: 'in:3', name: 'D', direction: 'input' },
        { id: 'out:0', name: 'BUS', direction: 'output' },
      ],
    }
    const foo: CompositeDef = {
      id: 'foo',
      name: 'foo',
      kind: 'composite',
      ports: [],
      instances: [inst('f1', fanIn4)],
      connections: [],
    }
    const design: Design = { version: 2, root: emptyRoot(), library: { foo } }

    const result = deleteTemplate(design, 'foo')
    expect(result.library['foo']).toBeUndefined()
  })

  it('returns the design unchanged when the template is missing', () => {
    const design = makeDesign()
    expect(deleteTemplate(design, 'nope')).toEqual(design)
  })
})
