import { describe, expect, it } from 'vitest'
import type { ComponentDef, Connection, Design, Instance, PinRef } from '../src/types'
import { inputPorts, outputPorts } from '../src/types'
import { inputPortDef, outputPortDef, primitiveDef } from '../src/primitives'
import { applyGroup, inferGroup } from '../src/group'

const inst = (id: string, defId: string, x = 0, y = 0): Instance => ({ id, name: id, defId, pos: { x, y } })
const iRef = (instanceId: string, portId: string): PinRef => ({ instanceId, portId })
const conn = (id: string, from: PinRef, to: PinRef): Connection => ({ id, from, to })
const pinEq = (c: Connection, from: PinRef, to: PinRef) =>
  c.from.instanceId === from.instanceId && c.from.portId === from.portId && c.to.instanceId === to.instanceId && c.to.portId === to.portId

function buildHalfAdderDesign(): Design {
  const defs: Record<string, Design['defs'][string]> = {
    xor: primitiveDef('xor'),
    and: primitiveDef('and'),
    clock: primitiveDef('clock'),
    or: primitiveDef('or'),
  }
  defs['main'] = {
    id: 'main',
    name: 'main',
    kind: 'composite',
    ports: [],
    instances: [
      inst('srcA', 'clock', 0, 0),
      inst('srcB', 'clock', 0, 120),
      inst('xor1', 'xor', 200, 40),
      inst('and1', 'and', 200, 180),
      inst('or1', 'or', 420, 110),
    ],
    connections: [
      conn('c1', iRef('srcA', 'out:0'), iRef('xor1', 'in:0')),
      conn('c2', iRef('srcB', 'out:0'), iRef('xor1', 'in:1')),
      conn('c3', iRef('srcA', 'out:0'), iRef('and1', 'in:0')),
      conn('c4', iRef('srcB', 'out:0'), iRef('and1', 'in:1')),
      conn('c5', iRef('xor1', 'out:0'), iRef('or1', 'in:0')),
      conn('c6', iRef('and1', 'out:0'), iRef('or1', 'in:1')),
    ],
  }
  return { version: 1, root: 'main', defs }
}

describe('inferGroup', () => {
  it('infers half-adder ports from the boundary nets', () => {
    const design = buildHalfAdderDesign()
    const g = inferGroup(design, 'main', ['xor1', 'and1'])

    expect(g.internal).toHaveLength(0)
    expect(g.inputs).toHaveLength(2)
    expect(g.outputs).toHaveLength(2)

    const inputBySource = (id: string) => g.inputs.find((p) => p.source?.instanceId === id)
    expect(inputBySource('srcA')?.targets).toEqual([
      { instanceId: 'xor1', portId: 'in:0' },
      { instanceId: 'and1', portId: 'in:0' },
    ])
    expect(inputBySource('srcB')?.targets).toEqual([
      { instanceId: 'xor1', portId: 'in:1' },
      { instanceId: 'and1', portId: 'in:1' },
    ])
  })
})

describe('applyGroup', () => {
  it('creates a composite with port instances, rewires the boundary, and updates the parent', () => {
    const design = buildHalfAdderDesign()
    const result = applyGroup(design, 'main', ['xor1', 'and1'], ['A', 'B'], ['S', 'C'])

    const main = result.defs['main']
    const compDef = result.defs['component']

    expect(compDef).toBeDefined()
    expect(inputPorts(compDef).map((p) => p.name)).toEqual(['A', 'B'])
    expect(outputPorts(compDef).map((p) => p.name)).toEqual(['S', 'C'])

    // Ports are linked to the single internal port-group instances.
    expect(inputPorts(compDef)[0].terminal).toEqual({ instanceId: 'component-in', pinId: 'in:0' })
    expect(outputPorts(compDef)[0].terminal).toEqual({ instanceId: 'component-out', pinId: 'out:0' })

    // The moved gates and the two port-group instances all live inside the new def.
    const ids = compDef.instances?.map((i) => i.id).sort()
    expect(ids).toEqual(['and1', 'component-in', 'component-out', 'xor1'].sort())
    const portDefs = compDef.instances!.filter((i) => i.defId === 'input-port' || i.defId === 'output-port')
    expect(portDefs).toHaveLength(2)

    // Internal wiring: inputs fan out to the gates, gates drive the outputs.
    expect(compDef.connections).toHaveLength(6)
    const in0Wiring = compDef.connections!.filter((c) => c.from.instanceId === 'component-in' && c.from.portId === 'in:0')
    expect(in0Wiring.map((c) => c.to)).toEqual([
      { instanceId: 'xor1', portId: 'in:0' },
      { instanceId: 'and1', portId: 'in:0' },
    ])

    // Parent no longer contains the grouped gates.
    const parentIds = main.instances?.map((i) => i.id).sort()
    expect(parentIds).toEqual(['or1', 'srcA', 'srcB', 'component-i'].sort())

    const compInst = main.instances!.find((i) => i.defId === 'component')!
    // srcA now drives the composite input in:0 (the internal fan-out to the gates
    // happens inside the composite via the input-port instance).
    const fromSrcA = main.connections!.filter((c) => c.from.instanceId === 'srcA')
    expect(fromSrcA.map((c) => c.to)).toEqual([{ instanceId: compInst.id, portId: 'in:0' }])
    // The composite output out:0 drives or1.in:0.
    const toOr0 = main.connections!.find((c) => c.to.instanceId === 'or1' && c.to.portId === 'in:0')
    expect(toOr0?.from).toEqual({ instanceId: compInst.id, portId: 'out:0' })
  })

  it('uses the supplied component name', () => {
    const design = buildHalfAdderDesign()
    const result = applyGroup(design, 'main', ['xor1', 'and1'], ['A', 'B'], ['S', 'C'], 'adder')
    expect(result.defs['adder']).toBeDefined()
    expect(result.defs['adder'].name).toBe('adder')
    // the parent instance is named after the component
    const main = result.defs['main']
    expect(main.instances!.some((i) => i.defId === 'adder~adder-i' || i.name === 'adder')).toBe(true)
  })

  it('keeps connections that do not touch the selection untouched', () => {
    const design = buildHalfAdderDesign()
    const result = applyGroup(design, 'main', ['xor1'], ['X1', 'X2'], ['Y'])

    const main = result.defs['main']
    // srcA -> and1 (untouched by grouping xor1) must remain.
    expect(main.connections!.some((c) => c.from.instanceId === 'srcA' && c.to.instanceId === 'and1')).toBe(true)
    expect(main.instances!.some((i) => i.id === 'xor1')).toBe(false)
    expect(main.instances!.some((i) => i.defId === 'component')).toBe(true)
  })
})

// A single AND gate whose in:1 and out:0 are floating (only in:0 is driven).
function buildFloatingPinsDesign(): Design {
  const defs: Record<string, Design['defs'][string]> = {
    and: primitiveDef('and'),
    clock: primitiveDef('clock'),
  }
  defs['main'] = {
    id: 'main',
    name: 'main',
    kind: 'composite',
    ports: [],
    instances: [inst('src', 'clock', 0, 0), inst('and1', 'and', 200, 0)],
    connections: [conn('c1', iRef('src', 'out:0'), iRef('and1', 'in:0'))],
  }
  return { version: 1, root: 'main', defs }
}

describe('inferGroup — exposed (floating) pins', () => {
  it('exposes unconnected inputs and outputs as ports', () => {
    const design = buildFloatingPinsDesign()
    const g = inferGroup(design, 'main', ['and1'])

    // One crossing input (src -> in:0), one exposed input (in:1), one exposed output (out:0).
    expect(g.inputs).toHaveLength(2)
    expect(g.inputs[0].source).toEqual({ instanceId: 'src', portId: 'out:0' })
    expect(g.inputs[0].targets).toEqual([{ instanceId: 'and1', portId: 'in:0' }])
    expect(g.inputs[1].source).toBeUndefined()
    expect(g.inputs[1].targets).toEqual([{ instanceId: 'and1', portId: 'in:1' }])

    expect(g.outputs).toHaveLength(1)
    expect(g.outputs[0].source).toEqual({ instanceId: 'and1', portId: 'out:0' })
    expect(g.outputs[0].targets).toEqual([])
  })
})

describe('applyGroup — exposed (floating) pins', () => {
  it('wires exposed ports internally and leaves no external connection', () => {
    const design = buildFloatingPinsDesign()
    const result = applyGroup(design, 'main', ['and1'], ['A', 'B'], ['Y'])

    const main = result.defs['main']
    const compDef = result.defs['component']

    expect(inputPorts(compDef).map((p) => p.name)).toEqual(['A', 'B'])
    expect(outputPorts(compDef).map((p) => p.name)).toEqual(['Y'])

    // Internal wiring: in:0 -> and1.in:0 (crossing), in:1 -> and1.in:1 (exposed),
    // and1.out:0 -> out:0 (exposed).
    expect(compDef.connections).toHaveLength(3)
    expect(compDef.connections!.some((c) => pinEq(c, iRef('component-in', 'in:0'), iRef('and1', 'in:0')))).toBe(true)
    expect(compDef.connections!.some((c) => pinEq(c, iRef('component-in', 'in:1'), iRef('and1', 'in:1')))).toBe(true)
    expect(compDef.connections!.some((c) => pinEq(c, iRef('and1', 'out:0'), iRef('component-out', 'out:0')))).toBe(true)

    // The parent's only external wiring is src -> component.in:0 (the crossing input).
    const compInst = main.instances!.find((i) => i.defId === 'component')!
    expect(main.connections).toHaveLength(1)
    expect(main.connections![0]).toMatchObject({
      from: { instanceId: 'src', portId: 'out:0' },
      to: { instanceId: compInst.id, portId: 'in:0' },
    })
  })
})

// A composite with its own input/output port groups wired through an AND gate.
function buildPortGroupDesign(): Design {
  const defs: Record<string, Design['defs'][string]> = {
    and: primitiveDef('and'),
    'input-port': inputPortDef(),
    'output-port': outputPortDef(),
  }
  defs['main'] = {
    id: 'main',
    name: 'main',
    kind: 'composite',
    ports: [
      { id: 'in:0', name: 'A', direction: 'input', terminal: { instanceId: 'in', pinId: 'in:0' } },
      { id: 'in:1', name: 'B', direction: 'input', terminal: { instanceId: 'in', pinId: 'in:1' } },
      { id: 'out:0', name: 'Y', direction: 'output', terminal: { instanceId: 'out', pinId: 'out:0' } },
    ],
    instances: [
      inst('in', 'input-port', 0, 0),
      inst('a', 'and', 100, 0),
      inst('out', 'output-port', 200, 0),
    ],
    connections: [
      conn('c1', iRef('in', 'in:0'), iRef('a', 'in:0')),
      conn('c2', iRef('in', 'in:1'), iRef('a', 'in:1')),
      conn('c3', iRef('a', 'out:0'), iRef('out', 'out:0')),
    ],
  }
  return { version: 1, root: 'main', defs }
}

describe('grouping with port groups in the selection', () => {
  it('treats port groups as the interface, not internals', () => {
    const design = buildPortGroupDesign()
    const g = inferGroup(design, 'main', ['a', 'in', 'out'])

    expect(g.internal).toHaveLength(0)
    expect(g.inputs.map((p) => p.source)).toEqual([
      { instanceId: 'in', portId: 'in:0' },
      { instanceId: 'in', portId: 'in:1' },
    ])
    expect(g.outputs.map((p) => p.source)).toEqual([{ instanceId: 'a', portId: 'out:0' }])
  })

  it('keeps port groups in the parent and moves only the gate', () => {
    const design = buildPortGroupDesign()
    const result = applyGroup(design, 'main', ['a', 'in', 'out'], ['A', 'B'], ['Y'])

    const main = result.defs['main']
    const comp = result.defs['component']

    // The new component holds the gate + its own port groups, not the parent's.
    expect(comp.instances!.map((i) => i.id).sort()).toEqual(['a', 'component-in', 'component-out'].sort())
    // The parent keeps its input/output port groups.
    expect(main.instances!.some((i) => i.id === 'in')).toBe(true)
    expect(main.instances!.some((i) => i.id === 'out')).toBe(true)
    // Ports inferred from the port-group boundary crossings.
    expect(inputPorts(comp).map((p) => p.name)).toEqual(['A', 'B'])
    expect(outputPorts(comp).map((p) => p.name)).toEqual(['Y'])

    // The parent's port groups now drive / are driven by the new instance.
    const compInst = main.instances!.find((i) => i.defId === 'component')!
    expect(main.connections!.some((c) => pinEq(c, iRef('in', 'in:0'), iRef(compInst.id, 'in:0')))).toBe(true)
    expect(main.connections!.some((c) => pinEq(c, iRef('in', 'in:1'), iRef(compInst.id, 'in:1')))).toBe(true)
    expect(main.connections!.some((c) => pinEq(c, iRef(compInst.id, 'out:0'), iRef('out', 'out:0')))).toBe(true)
  })
})

// A composite whose ports A/B/C (inputs) and Y (output) are wired through a 4-input
// AND, with C (in:2) and a.in:3 unwired, plus an unselected clock feeding a.in:2.
function makeAndN(n: number): ComponentDef {
  const ports: ComponentDef['ports'] = []
  for (let i = 0; i < n; i++) ports.push({ id: `in:${i}`, name: `A${i}`, direction: 'input' })
  ports.push({ id: 'out:0', name: 'Y', direction: 'output' })
  return { id: 'and-n', name: 'AND', kind: 'primitive', primitive: 'and', ports }
}

function buildInheritedInterfaceDesign(): Design {
  const defs: Record<string, Design['defs'][string]> = {
    'and-n': makeAndN(4),
    clock: primitiveDef('clock'),
    'input-port': inputPortDef(),
    'output-port': outputPortDef(),
  }
  defs['main'] = {
    id: 'main',
    name: 'main',
    kind: 'composite',
    ports: [
      { id: 'in:0', name: 'A', direction: 'input', terminal: { instanceId: 'in', pinId: 'in:0' } },
      { id: 'in:1', name: 'B', direction: 'input', terminal: { instanceId: 'in', pinId: 'in:1' } },
      { id: 'in:2', name: 'C', direction: 'input', terminal: { instanceId: 'in', pinId: 'in:2' } },
      { id: 'out:0', name: 'Y', direction: 'output', terminal: { instanceId: 'out', pinId: 'out:0' } },
    ],
    instances: [
      inst('in', 'input-port', 0, 0),
      inst('a', 'and-n', 100, 0),
      inst('out', 'output-port', 200, 0),
      inst('clk', 'clock', -100, 0),
    ],
    connections: [
      conn('c1', iRef('in', 'in:0'), iRef('a', 'in:0')),
      conn('c2', iRef('in', 'in:1'), iRef('a', 'in:1')),
      conn('c3', iRef('clk', 'out:0'), iRef('a', 'in:2')),
      conn('c4', iRef('a', 'out:0'), iRef('out', 'out:0')),
    ],
  }
  return { version: 1, root: 'main', defs }
}

describe('grouping with the parent port groups included', () => {
  it('inherits names/count and disables floating discovery', () => {
    const design = buildInheritedInterfaceDesign()
    const g = inferGroup(design, 'main', ['a', 'in', 'out'])

    // Inputs: A, B, C inherited (C unwired) + the clk crossing (no inherited name).
    expect(g.inputs).toHaveLength(4)
    expect(g.inputs[0]).toMatchObject({
      name: 'A',
      source: { instanceId: 'in', portId: 'in:0' },
      targets: [{ instanceId: 'a', portId: 'in:0' }],
    })
    expect(g.inputs[1]).toMatchObject({
      name: 'B',
      source: { instanceId: 'in', portId: 'in:1' },
      targets: [{ instanceId: 'a', portId: 'in:1' }],
    })
    expect(g.inputs[2]).toMatchObject({ name: 'C', source: { instanceId: 'in', portId: 'in:2' }, targets: [] })
    expect(g.inputs[3].name).toBeUndefined()
    expect(g.inputs[3].source).toEqual({ instanceId: 'clk', portId: 'out:0' })
    expect(g.inputs[3].targets).toEqual([{ instanceId: 'a', portId: 'in:2' }])
    // The floating a.in:3 is NOT discovered (discovery disabled).
    expect(g.inputs.some((p) => p.targets.some((t) => t.instanceId === 'a' && t.portId === 'in:3'))).toBe(false)

    // Output: Y inherited.
    expect(g.outputs).toHaveLength(1)
    expect(g.outputs[0]).toMatchObject({
      name: 'Y',
      source: { instanceId: 'a', portId: 'out:0' },
      targets: [{ instanceId: 'out', portId: 'out:0' }],
    })
  })

  it('builds the inherited interface and rewires the parent', () => {
    const design = buildInheritedInterfaceDesign()
    const result = applyGroup(design, 'main', ['a', 'in', 'out'], ['A', 'B', 'C', 'EXTRA'], ['Y'])

    const main = result.defs['main']
    const comp = result.defs['component']

    expect(inputPorts(comp).map((p) => p.name)).toEqual(['A', 'B', 'C', 'EXTRA'])
    expect(outputPorts(comp).map((p) => p.name)).toEqual(['Y'])

    // Internal wiring: A->a.in:0, B->a.in:1, EXTRA->a.in:2, a.out:0->Y; C (in:2) unwired.
    expect(comp.connections!.some((c) => pinEq(c, iRef('component-in', 'in:0'), iRef('a', 'in:0')))).toBe(true)
    expect(comp.connections!.some((c) => pinEq(c, iRef('component-in', 'in:1'), iRef('a', 'in:1')))).toBe(true)
    expect(comp.connections!.some((c) => pinEq(c, iRef('component-in', 'in:3'), iRef('a', 'in:2')))).toBe(true)
    expect(comp.connections!.some((c) => pinEq(c, iRef('a', 'out:0'), iRef('component-out', 'out:0')))).toBe(true)
    expect(comp.connections!.some((c) => c.from.portId === 'in:2')).toBe(false)

    // Parent keeps in, out, clk + the new instance.
    const compInst = main.instances!.find((i) => i.defId === 'component')!
    expect(main.instances!.some((i) => i.id === 'in')).toBe(true)
    expect(main.instances!.some((i) => i.id === 'out')).toBe(true)
    expect(main.instances!.some((i) => i.id === 'clk')).toBe(true)

    // Parent rewiring: every parent input pin (incl. unwired C) drives the new input.
    expect(main.connections!.some((c) => pinEq(c, iRef('in', 'in:0'), iRef(compInst.id, 'in:0')))).toBe(true)
    expect(main.connections!.some((c) => pinEq(c, iRef('in', 'in:1'), iRef(compInst.id, 'in:1')))).toBe(true)
    expect(main.connections!.some((c) => pinEq(c, iRef('in', 'in:2'), iRef(compInst.id, 'in:2')))).toBe(true)
    expect(main.connections!.some((c) => pinEq(c, iRef('clk', 'out:0'), iRef(compInst.id, 'in:3')))).toBe(true)
    expect(main.connections!.some((c) => pinEq(c, iRef(compInst.id, 'out:0'), iRef('out', 'out:0')))).toBe(true)
  })
})
