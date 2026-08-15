import { describe, expect, it } from 'vitest'
import type { Connection, Design, Instance, PinRef } from '../src/types'
import { inputPorts, outputPorts } from '../src/types'
import { primitiveDef } from '../src/primitives'
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
