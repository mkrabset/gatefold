import { describe, expect, it } from 'vitest'
import type { ComponentDef, Design, Instance } from '../src/types'
import { inputPortDef, outputPortDef, primitiveDef } from '../src/primitives'
import { cloneDef } from '../src/group'
import { exportLibrary, importLibrary, parseLibrary, serializeLibrary } from '../src/library'

const inst = (id: string, defId: string, x = 0, y = 0): Instance => ({ id, name: id, defId, pos: { x, y } })

function makeDesign(): Design {
  const defs: Record<string, ComponentDef> = {
    and: primitiveDef('and'),
    or: primitiveDef('or'),
    'input-port': inputPortDef(),
    'output-port': outputPortDef(),
    // A variant primitive clone, as produced by copy-on-place (should normalize to 'and').
    'and~v': { ...primitiveDef('and'), id: 'and~v', variant: true },
  }
  defs['bar'] = {
    id: 'bar',
    name: 'bar',
    kind: 'composite',
    ports: [],
    instances: [inst('o1', 'or')],
    connections: [],
  }
  defs['foo'] = {
    id: 'foo',
    name: 'foo',
    kind: 'composite',
    ports: [],
    instances: [inst('a1', 'and~v'), inst('b1', 'bar', 100)],
    connections: [],
  }
  // An instance-local variant copy of foo — must NOT be exported as a library root.
  defs['foo~x'] = { ...cloneDef(defs['foo']), id: 'foo~x', variant: true }
  defs['main'] = {
    id: 'main',
    name: 'main',
    kind: 'composite',
    ports: [],
    instances: [inst('f1', 'foo~x')],
    connections: [],
  }
  return { version: 1, root: 'main', defs }
}

describe('exportLibrary', () => {
  it('exports template composites and their composite closure only', () => {
    const design = makeDesign()
    const lib = exportLibrary(design)

    const ids = lib.components.map((c) => c.id).sort()
    expect(ids).toEqual(['bar', 'foo'])

    // No primitives, port groups, variants, or the root.
    expect(lib.components.every((c) => c.kind === 'composite')).toBe(true)
    expect(lib.components.every((c) => !c.variant)).toBe(true)
  })

  it('normalizes references to variant primitive copies back to the built-in id', () => {
    const design = makeDesign()
    const lib = exportLibrary(design)
    const foo = lib.components.find((c) => c.id === 'foo')!
    const a1 = foo.instances!.find((i) => i.id === 'a1')!
    expect(a1.defId).toBe('and')
    // Nested composite reference is preserved.
    const b1 = foo.instances!.find((i) => i.id === 'b1')!
    expect(b1.defId).toBe('bar')
  })

  it('round-trips through serializeLibrary / parseLibrary', () => {
    const design = makeDesign()
    expect(parseLibrary(serializeLibrary(exportLibrary(design)))).toEqual(exportLibrary(design))
  })

  it('rejects invalid library JSON', () => {
    expect(() => parseLibrary('nope')).toThrow()
    expect(() => parseLibrary('{"version":1,"components":[{}}]')).toThrow()
  })
})

describe('importLibrary', () => {
  it('merges components into the design with fresh ids and names', () => {
    const design = makeDesign()
    const lib = exportLibrary(design)

    // Import into a clean target that only has the built-ins.
    const target: Design = {
      version: 1,
      root: 'main',
      defs: {
        and: primitiveDef('and'),
        or: primitiveDef('or'),
        'input-port': inputPortDef(),
        'output-port': outputPortDef(),
        main: { id: 'main', name: 'main', kind: 'composite', ports: [], instances: [], connections: [] },
      },
    }

    const result = importLibrary(target, lib)
    expect(result.defs['foo']).toBeDefined()
    expect(result.defs['bar']).toBeDefined()
    // Imported components get fresh lineage ids.
    expect(result.defs['foo'].uuid).toBeTruthy()
    expect(result.defs['bar'].uuid).toBeTruthy()
    expect(result.defs['foo'].uuid).not.toBe(result.defs['bar'].uuid)
    // Internal nested reference resolves to the imported bar.
    const foo = result.defs['foo']
    expect(foo.instances!.find((i) => i.id === 'b1')!.defId).toBe('bar')
    // Primitive reference stays a built-in id.
    expect(foo.instances!.find((i) => i.id === 'a1')!.defId).toBe('and')
  })

  it('renames on collision instead of overwriting', () => {
    const design = makeDesign()
    const lib = exportLibrary(design)

    const first = importLibrary(design, lib)
    const second = importLibrary(first, lib)

    // Original components survive, and the second import gets suffixed ids/names.
    expect(second.defs['foo']).toBeDefined()
    expect(second.defs['foo~2']).toBeDefined()
    expect(second.defs['foo~2'].name).toBe('foo~2')
    // The re-imported copy's nested reference remaps to its own 'bar~2'.
    const foo2 = second.defs['foo~2']
    expect(foo2.instances!.find((i) => i.id === 'b1')!.defId).toBe('bar~2')
  })
})
