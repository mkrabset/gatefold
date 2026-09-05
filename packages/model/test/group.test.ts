import { describe, expect, it } from 'vitest'
import type { ChildDef, CompositeDef, Connection, Design, Instance, PinRef } from '../src/types'
import { inputPorts, outputPorts } from '../src/types'
import { forkOf } from '../src/primitives'
import { applyGroup, inferGroup } from '../src/group'

const inst = (id: string, def: ChildDef, x = 0, y = 0): Instance => ({ id, name: id, def, pos: { x, y } })
const iRef = (instanceId: string, portId: string): PinRef => ({ instanceId, portId })
const conn = (id: string, from: PinRef, to: PinRef): Connection => ({ id, from, to })
const pinEq = (c: Connection, from: PinRef, to: PinRef) =>
  c.from.instanceId === from.instanceId && c.from.portId === from.portId && c.to.instanceId === to.instanceId && c.to.portId === to.portId

const INPUT_PORT: ChildDef = { kind: 'builtin', primitive: 'input-port' }
const OUTPUT_PORT: ChildDef = { kind: 'builtin', primitive: 'output-port' }
const isPortGroupInst = (i: Instance): boolean =>
  i.def.kind === 'builtin' && (i.def.primitive === 'input-port' || i.def.primitive === 'output-port')

function buildHalfAdderDesign(): Design {
  const main: CompositeDef = {
    id: 'main',
    name: 'main',
    kind: 'composite',
    ports: [],
    instances: [
      inst('srcA', forkOf('clock'), 0, 0),
      inst('srcB', forkOf('clock'), 0, 120),
      inst('xor1', forkOf('xor'), 200, 40),
      inst('and1', forkOf('and'), 200, 180),
      inst('or1', forkOf('or'), 420, 110),
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
  return { version: 2, root: main, library: {} }
}

describe('inferGroup', () => {
  it('infers half-adder ports from the boundary nets', () => {
    const design = buildHalfAdderDesign()
    const g = inferGroup(design.root, ['xor1', 'and1'])

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

    const main = result.root
    const compDef = result.library['component']

    expect(compDef).toBeDefined()
    expect(inputPorts(compDef.ports).map((p) => p.name)).toEqual(['A', 'B'])
    expect(outputPorts(compDef.ports).map((p) => p.name)).toEqual(['S', 'C'])

    // Ports are linked to the single internal port-group instances.
    expect(inputPorts(compDef.ports)[0].terminal).toEqual({ instanceId: 'component-in', pinId: 'in:0' })
    expect(outputPorts(compDef.ports)[0].terminal).toEqual({ instanceId: 'component-out', pinId: 'out:0' })

    // The moved gates and the two port-group instances all live inside the new def.
    const ids = compDef.instances.map((i) => i.id).sort()
    expect(ids).toEqual(['and1', 'component-in', 'component-out', 'xor1'].sort())
    expect(compDef.instances.filter(isPortGroupInst)).toHaveLength(2)

    // Internal wiring: inputs fan out to the gates, gates drive the outputs.
    expect(compDef.connections).toHaveLength(6)
    const in0Wiring = compDef.connections.filter((c) => c.from.instanceId === 'component-in' && c.from.portId === 'in:0')
    expect(in0Wiring.map((c) => c.to)).toEqual([
      { instanceId: 'xor1', portId: 'in:0' },
      { instanceId: 'and1', portId: 'in:0' },
    ])

    // Parent no longer contains the grouped gates.
    const parentIds = main.instances.map((i) => i.id).sort()
    expect(parentIds).toEqual(['or1', 'srcA', 'srcB', 'component-i'].sort())

    const compInst = main.instances.find((i) => i.def.kind === 'composite' && i.def.id === 'component')!
    // srcA now drives the composite input in:0.
    const fromSrcA = main.connections.filter((c) => c.from.instanceId === 'srcA')
    expect(fromSrcA.map((c) => c.to)).toEqual([{ instanceId: compInst.id, portId: 'in:0' }])
    // The composite output out:0 drives or1.in:0.
    const toOr0 = main.connections.find((c) => c.to.instanceId === 'or1' && c.to.portId === 'in:0')
    expect(toOr0?.from).toEqual({ instanceId: compInst.id, portId: 'out:0' })
  })

  it('uses the supplied component name', () => {
    const design = buildHalfAdderDesign()
    const result = applyGroup(design, 'main', ['xor1', 'and1'], ['A', 'B'], ['S', 'C'], 'adder')
    expect(result.library['adder']).toBeDefined()
    expect(result.library['adder'].name).toBe('adder')
    const main = result.root
    expect(main.instances.some((i) => i.def.kind === 'composite' && i.def.id === 'adder' && i.name === '')).toBe(true)
  })

  it('ignores live-copy names when naming the new template', () => {
    const design = buildHalfAdderDesign()
    // A live copy (nested composite) whose display name collides with the default name.
    design.root.instances.push(
      inst('live', { kind: 'composite', id: 'comp~x', name: 'component', ports: [], instances: [], connections: [] }, 500, 500),
    )
    const result = applyGroup(design, 'main', ['xor1'], ['X1', 'X2'], ['Y'])
    expect(result.library['component'].name).toBe('component')
  })

  it('keeps connections that do not touch the selection untouched', () => {
    const design = buildHalfAdderDesign()
    const result = applyGroup(design, 'main', ['xor1'], ['X1', 'X2'], ['Y'])

    const main = result.root
    // srcA -> and1 (untouched by grouping xor1) must remain.
    expect(main.connections.some((c) => c.from.instanceId === 'srcA' && c.to.instanceId === 'and1')).toBe(true)
    expect(main.instances.some((i) => i.id === 'xor1')).toBe(false)
    expect(main.instances.some((i) => i.def.kind === 'composite' && i.def.id === 'component')).toBe(true)
  })
})

// A single AND gate whose in:1 and out:0 are floating (only in:0 is driven).
function buildFloatingPinsDesign(): Design {
  const main: CompositeDef = {
    id: 'main',
    name: 'main',
    kind: 'composite',
    ports: [],
    instances: [inst('src', forkOf('clock'), 0, 0), inst('and1', forkOf('and'), 200, 0)],
    connections: [conn('c1', iRef('src', 'out:0'), iRef('and1', 'in:0'))],
  }
  return { version: 2, root: main, library: {} }
}

describe('inferGroup — exposed (floating) pins', () => {
  it('exposes unconnected inputs and outputs as ports', () => {
    const design = buildFloatingPinsDesign()
    const g = inferGroup(design.root, ['and1'])

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

    const main = result.root
    const compDef = result.library['component']

    expect(inputPorts(compDef.ports).map((p) => p.name)).toEqual(['A', 'B'])
    expect(outputPorts(compDef.ports).map((p) => p.name)).toEqual(['Y'])

    expect(compDef.connections).toHaveLength(3)
    expect(compDef.connections.some((c) => pinEq(c, iRef('component-in', 'in:0'), iRef('and1', 'in:0')))).toBe(true)
    expect(compDef.connections.some((c) => pinEq(c, iRef('component-in', 'in:1'), iRef('and1', 'in:1')))).toBe(true)
    expect(compDef.connections.some((c) => pinEq(c, iRef('and1', 'out:0'), iRef('component-out', 'out:0')))).toBe(true)

    const compInst = main.instances.find((i) => i.def.kind === 'composite' && i.def.id === 'component')!
    expect(main.connections).toHaveLength(1)
    expect(main.connections[0]).toMatchObject({
      from: { instanceId: 'src', portId: 'out:0' },
      to: { instanceId: compInst.id, portId: 'in:0' },
    })
  })
})

// A composite with its own input/output port groups wired through an AND gate.
function buildPortGroupDesign(): Design {
  const main: CompositeDef = {
    id: 'main',
    name: 'main',
    kind: 'composite',
    ports: [
      { id: 'in:0', name: 'A', direction: 'input', terminal: { instanceId: 'in', pinId: 'in:0' } },
      { id: 'in:1', name: 'B', direction: 'input', terminal: { instanceId: 'in', pinId: 'in:1' } },
      { id: 'out:0', name: 'Y', direction: 'output', terminal: { instanceId: 'out', pinId: 'out:0' } },
    ],
    instances: [
      inst('in', INPUT_PORT, 0, 0),
      inst('a', forkOf('and'), 100, 0),
      inst('out', OUTPUT_PORT, 200, 0),
    ],
    connections: [
      conn('c1', iRef('in', 'in:0'), iRef('a', 'in:0')),
      conn('c2', iRef('in', 'in:1'), iRef('a', 'in:1')),
      conn('c3', iRef('a', 'out:0'), iRef('out', 'out:0')),
    ],
  }
  return { version: 2, root: main, library: {} }
}

describe('grouping with port groups in the selection', () => {
  it('treats port groups as the interface, not internals', () => {
    const design = buildPortGroupDesign()
    const g = inferGroup(design.root, ['a', 'in', 'out'])

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

    const main = result.root
    const comp = result.library['component']

    expect(comp.instances.map((i) => i.id).sort()).toEqual(['a', 'component-in', 'component-out'].sort())
    expect(main.instances.some((i) => i.id === 'in')).toBe(true)
    expect(main.instances.some((i) => i.id === 'out')).toBe(true)
    expect(inputPorts(comp.ports).map((p) => p.name)).toEqual(['A', 'B'])
    expect(outputPorts(comp.ports).map((p) => p.name)).toEqual(['Y'])

    const compInst = main.instances.find((i) => i.def.kind === 'composite' && i.def.id === 'component')!
    expect(main.connections.some((c) => pinEq(c, iRef('in', 'in:0'), iRef(compInst.id, 'in:0')))).toBe(true)
    expect(main.connections.some((c) => pinEq(c, iRef('in', 'in:1'), iRef(compInst.id, 'in:1')))).toBe(true)
    expect(main.connections.some((c) => pinEq(c, iRef(compInst.id, 'out:0'), iRef('out', 'out:0')))).toBe(true)
  })

  it('keeps the new port groups at the original port-group positions', () => {
    const design = buildPortGroupDesign()
    const result = applyGroup(design, 'main', ['a', 'in', 'out'], ['A', 'B'], ['Y'])

    const comp = result.library['component']
    const inGroup = comp.instances.find((i) => i.def.kind === 'builtin' && i.def.primitive === 'input-port')!
    const outGroup = comp.instances.find((i) => i.def.kind === 'builtin' && i.def.primitive === 'output-port')!
    expect(inGroup.pos).toEqual({ x: 0, y: 0 })
    expect(outGroup.pos).toEqual({ x: 200, y: 0 })
  })
})

// A composite whose ports A/B/C (inputs) and Y (output) are wired through a 4-input
// AND, with C (in:2) and a.in:3 unwired, plus an unselected clock feeding a.in:2.
function makeAndN(n: number): ChildDef {
  const ports = []
  for (let i = 0; i < n; i++) ports.push({ id: `in:${i}`, name: `A${i}`, direction: 'input' as const })
  ports.push({ id: 'out:0', name: 'Y', direction: 'output' as const })
  return { kind: 'fork', primitive: 'and', ports }
}

function buildInheritedInterfaceDesign(): Design {
  const main: CompositeDef = {
    id: 'main',
    name: 'main',
    kind: 'composite',
    ports: [
      { id: 'in:0', name: 'A', direction: 'input', terminal: { instanceId: 'in', pinId: 'in:0' } },
      { id: 'in:1', name: 'B', direction: 'input', inverted: true, terminal: { instanceId: 'in', pinId: 'in:1' } },
      { id: 'in:2', name: 'C', direction: 'input', terminal: { instanceId: 'in', pinId: 'in:2' } },
      { id: 'out:0', name: 'Y', direction: 'output', inverted: true, terminal: { instanceId: 'out', pinId: 'out:0' } },
    ],
    instances: [
      inst('in', INPUT_PORT, 0, 0),
      inst('a', makeAndN(4), 100, 0),
      inst('out', OUTPUT_PORT, 200, 0),
      inst('clk', forkOf('clock'), -100, 0),
    ],
    connections: [
      conn('c1', iRef('in', 'in:0'), iRef('a', 'in:0')),
      conn('c2', iRef('in', 'in:1'), iRef('a', 'in:1')),
      conn('c3', iRef('clk', 'out:0'), iRef('a', 'in:2')),
      conn('c4', iRef('a', 'out:0'), iRef('out', 'out:0')),
    ],
  }
  return { version: 2, root: main, library: {} }
}

describe('grouping with the parent port groups included', () => {
  it('inherits names/count and disables floating discovery', () => {
    const design = buildInheritedInterfaceDesign()
    const g = inferGroup(design.root, ['a', 'in', 'out'])

    expect(g.inputs).toHaveLength(4)
    expect(g.inputs[0]).toMatchObject({
      name: 'A',
      source: { instanceId: 'in', portId: 'in:0' },
      targets: [{ instanceId: 'a', portId: 'in:0' }],
    })
    expect(g.inputs[1]).toMatchObject({
      name: 'B',
      inverted: true,
      source: { instanceId: 'in', portId: 'in:1' },
      targets: [{ instanceId: 'a', portId: 'in:1' }],
    })
    expect(g.inputs[2]).toMatchObject({ name: 'C', source: { instanceId: 'in', portId: 'in:2' }, targets: [] })
    expect(g.inputs[3].name).toBeUndefined()
    expect(g.inputs[3].source).toEqual({ instanceId: 'clk', portId: 'out:0' })
    expect(g.inputs[3].targets).toEqual([{ instanceId: 'a', portId: 'in:2' }])
    expect(g.inputs.some((p) => p.targets.some((t) => t.instanceId === 'a' && t.portId === 'in:3'))).toBe(false)

    expect(g.outputs).toHaveLength(1)
    expect(g.outputs[0]).toMatchObject({
      name: 'Y',
      inverted: true,
      source: { instanceId: 'a', portId: 'out:0' },
      targets: [{ instanceId: 'out', portId: 'out:0' }],
    })
  })

  it('builds the inherited interface and rewires the parent', () => {
    const design = buildInheritedInterfaceDesign()
    const result = applyGroup(design, 'main', ['a', 'in', 'out'], ['A', 'B', 'C', 'EXTRA'], ['Y'])

    const main = result.root
    const comp = result.library['component']

    expect(inputPorts(comp.ports).map((p) => p.name)).toEqual(['A', 'B', 'C', 'EXTRA'])
    expect(outputPorts(comp.ports).map((p) => p.name)).toEqual(['Y'])
    expect(inputPorts(comp.ports).map((p) => p.inverted === true)).toEqual([false, false, false, false])
    expect(outputPorts(comp.ports)[0].inverted).toBeUndefined()

    expect(comp.connections.some((c) => pinEq(c, iRef('component-in', 'in:0'), iRef('a', 'in:0')))).toBe(true)
    expect(comp.connections.some((c) => pinEq(c, iRef('component-in', 'in:1'), iRef('a', 'in:1')))).toBe(true)
    expect(comp.connections.some((c) => pinEq(c, iRef('component-in', 'in:3'), iRef('a', 'in:2')))).toBe(true)
    expect(comp.connections.some((c) => pinEq(c, iRef('a', 'out:0'), iRef('component-out', 'out:0')))).toBe(true)
    expect(comp.connections.some((c) => c.from.portId === 'in:2')).toBe(false)

    const compInst = main.instances.find((i) => i.def.kind === 'composite' && i.def.id === 'component')!
    expect(main.instances.some((i) => i.id === 'in')).toBe(true)
    expect(main.instances.some((i) => i.id === 'out')).toBe(true)
    expect(main.instances.some((i) => i.id === 'clk')).toBe(true)

    expect(main.connections.some((c) => pinEq(c, iRef('in', 'in:0'), iRef(compInst.id, 'in:0')))).toBe(true)
    expect(main.connections.some((c) => pinEq(c, iRef('in', 'in:1'), iRef(compInst.id, 'in:1')))).toBe(true)
    expect(main.connections.some((c) => pinEq(c, iRef('in', 'in:2'), iRef(compInst.id, 'in:2')))).toBe(true)
    expect(main.connections.some((c) => pinEq(c, iRef('clk', 'out:0'), iRef(compInst.id, 'in:3')))).toBe(true)
    expect(main.connections.some((c) => pinEq(c, iRef(compInst.id, 'out:0'), iRef('out', 'out:0')))).toBe(true)
  })
})
