import { describe, expect, it } from 'vitest'
import type { ComponentDef, CompositeDef, Design, Instance, PrimitiveDef } from '../src/types'
import { inputPortId, outputPortId } from '../src/types'
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
    category: 'Logic',
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

function makeNestedDesign(): Design {
  const defs: Record<string, ComponentDef> = {
    and: primitiveDef('and'),
    'input-port': inputPortDef(),
    'output-port': outputPortDef(),
  }
  defs['half-adder'] = {
    id: 'half-adder',
    name: 'half-adder',
    kind: 'composite',
    uuid: 'uuid-ha',
    ports: [],
    instances: [inst('x1', 'and')],
    connections: [],
  }
  defs['adder'] = {
    id: 'adder',
    name: 'adder',
    kind: 'composite',
    uuid: 'uuid-adder',
    ports: [],
    // Copy-on-place: adder contains a variant copy of half-adder, not the template itself.
    instances: [inst('h1', 'half-adder~2')],
    connections: [],
  }
  defs['half-adder~2'] = { ...cloneDef(defs['half-adder']), id: 'half-adder~2', variant: true }
  defs['adder~9'] = { ...cloneDef(defs['adder']), id: 'adder~9', variant: true }
  defs['main'] = {
    id: 'main',
    name: 'main',
    kind: 'composite',
    ports: [],
    instances: [inst('a1', 'adder~9')],
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
    const foo = lib.components.find((c) => c.id === 'foo')! as CompositeDef
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

  it('preserves a template\'s category through export and import', () => {
    const design = makeDesign()
    const lib = exportLibrary(design)
    const bar = lib.components.find((c) => c.id === 'bar')! as CompositeDef
    expect(bar.category).toBe('Logic')

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
    expect((result.defs['bar'] as CompositeDef).category).toBe('Logic')
  })

  it('rejects invalid library JSON', () => {
    expect(() => parseLibrary('nope')).toThrow()
    expect(() => parseLibrary('{"version":1,"components":[{}}]')).toThrow()
  })

  it('collapses variant copies back to their template so only templates are exported', () => {
    const lib = exportLibrary(makeNestedDesign())

    const ids = lib.components.map((c) => c.id).sort()
    expect(ids).toEqual(['adder', 'half-adder'])

    // The nested reference points at the template, not the variant copy.
    const adder = lib.components.find((c) => c.id === 'adder')! as CompositeDef
    expect(adder.instances!.find((i) => i.id === 'h1')!.defId).toBe('half-adder')
  })

  it('promotes an orphaned variant so the export stays self-contained', () => {
    const design = makeNestedDesign()
    // Delete the half-adder template, leaving only its variant copy referenced by adder.
    delete design.defs['half-adder']

    const lib = exportLibrary(design)
    const ids = lib.components.map((c) => c.id).sort()
    expect(ids).toEqual(['adder', 'half-adder~2'])

    const adder = lib.components.find((c) => c.id === 'adder')! as CompositeDef
    expect(adder.instances!.find((i) => i.id === 'h1')!.defId).toBe('half-adder~2')
    expect(lib.components.every((c) => !c.variant)).toBe(true)
  })

  it('preserves a primitive variant with non-default ports (custom-arity fan-in)', () => {
    const fanIn4: PrimitiveDef = {
      id: 'fan-in~4',
      name: 'FAN-IN',
      kind: 'primitive',
      primitive: 'fan-in',
      variant: true,
      ports: [
        { id: inputPortId(0), name: 'A', direction: 'input' },
        { id: inputPortId(1), name: 'B', direction: 'input' },
        { id: inputPortId(2), name: 'C', direction: 'input' },
        { id: inputPortId(3), name: 'D', direction: 'input' },
        { id: outputPortId(0), name: 'BUS', direction: 'output' },
      ],
    }
    const design: Design = {
      version: 1,
      root: 'main',
      defs: {
        'fan-in': primitiveDef('fan-in'),
        'input-port': inputPortDef(),
        'output-port': outputPortDef(),
        'fan-in~4': fanIn4,
        foo: {
          id: 'foo',
          name: 'foo',
          kind: 'composite',
          ports: [],
          instances: [inst('f1', 'fan-in~4')],
          connections: [],
        },
        main: {
          id: 'main',
          name: 'main',
          kind: 'composite',
          ports: [],
          instances: [inst('x1', 'foo')],
          connections: [],
        },
      },
    }

    const lib = exportLibrary(design)

    // The custom fan-in is exported as a primitive component with 4 inputs.
    const fanInComponent = lib.components.find((c) => c.kind === 'primitive' && c.primitive === 'fan-in')
    expect(fanInComponent).toBeDefined()
    expect((fanInComponent as PrimitiveDef).ports.filter((p) => p.direction === 'input')).toHaveLength(4)

    // The instance references the exported primitive component, not the built-in id.
    const foo = lib.components.find((c) => c.id === 'foo')! as CompositeDef
    expect(foo.instances!.find((i) => i.id === 'f1')!.defId).toBe('fan-in~4')
  })

  it('restores a custom-arity fan-in through export + import', () => {
    const design: Design = {
      version: 1,
      root: 'main',
      defs: {
        'fan-in': primitiveDef('fan-in'),
        'input-port': inputPortDef(),
        'output-port': outputPortDef(),
        'fan-in~4': {
          id: 'fan-in~4',
          name: 'FAN-IN',
          kind: 'primitive',
          primitive: 'fan-in',
          variant: true,
          ports: [
            { id: inputPortId(0), name: 'A', direction: 'input' },
            { id: inputPortId(1), name: 'B', direction: 'input' },
            { id: inputPortId(2), name: 'C', direction: 'input' },
            { id: inputPortId(3), name: 'D', direction: 'input' },
            { id: outputPortId(0), name: 'BUS', direction: 'output' },
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
        main: {
          id: 'main',
          name: 'main',
          kind: 'composite',
          ports: [],
          instances: [inst('x1', 'foo')],
          connections: [],
        },
      },
    }

    const lib = parseLibrary(serializeLibrary(exportLibrary(design)))

    const target: Design = {
      version: 1,
      root: 'main',
      defs: {
        'fan-in': primitiveDef('fan-in'),
        'input-port': inputPortDef(),
        'output-port': outputPortDef(),
        main: { id: 'main', name: 'main', kind: 'composite', ports: [], instances: [], connections: [] },
      },
    }

    const result = importLibrary(target, lib)
    const importedFoo = result.defs['foo'] as CompositeDef
    const fanInId = importedFoo.instances!.find((i) => i.id === 'f1')!.defId
    const importedFan = result.defs[fanInId] as PrimitiveDef
    expect(importedFan.primitive).toBe('fan-in')
    expect(importedFan.ports.filter((p) => p.direction === 'input')).toHaveLength(4)
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
    const foo = result.defs['foo'] as CompositeDef
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
    const foo2 = second.defs['foo~2'] as CompositeDef
    expect(foo2.instances!.find((i) => i.id === 'b1')!.defId).toBe('bar~2')
  })
})
