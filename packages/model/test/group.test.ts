import { describe, expect, it } from 'vitest'
import type { Connection, Design, Instance, PinRef } from '../src/types'
import { inputPorts, outputPorts } from '../src/types'
import { primitiveDef } from '../src/primitives'
import { applyGroup, inferGroup } from '../src/group'

const inst = (id: string, defId: string, x = 0, y = 0): Instance => ({ id, name: id, defId, pos: { x, y } })
const iRef = (instanceId: string, portId: string): PinRef => ({ kind: 'instance', instanceId, portId })
const conn = (id: string, from: PinRef, to: PinRef): Connection => ({ id, from, to })

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

    const inputBySource = (id: string) => g.inputs.find((p) => p.source.kind === 'instance' && p.source.instanceId === id)
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
  it('creates a composite, rewires the boundary, and updates the parent', () => {
    const design = buildHalfAdderDesign()
    const result = applyGroup(design, 'main', ['xor1', 'and1'], ['A', 'B'], ['S', 'C'])

    const main = result.defs['main']
    const compDef = result.defs['component']

    expect(compDef).toBeDefined()
    expect(inputPorts(compDef).map((p) => p.name)).toEqual(['A', 'B'])
    expect(outputPorts(compDef).map((p) => p.name)).toEqual(['S', 'C'])

    // moved instances kept, with their positions
    expect(compDef.instances?.map((i) => i.id).sort()).toEqual(['and1', 'xor1'])

    // internal wiring through the composite ports
    expect(compDef.connections).toHaveLength(6)

    // parent no longer contains the grouped gates
    const parentIds = main.instances?.map((i) => i.id).sort()
    expect(parentIds).toEqual(['or1', 'srcA', 'srcB', 'component-i'].sort())

    const compInst = main.instances!.find((i) => i.defId === 'component')!
    const externalFrom = (instanceId: string) =>
      main.connections!.filter((c) => c.from.kind === 'instance' && c.from.instanceId === instanceId)

    // srcA now drives the composite input in:0
    expect(externalFrom('srcA')[0].to).toEqual({ kind: 'instance', instanceId: compInst.id, portId: 'in:0' })
    // the composite output out:0 drives or1.in:0
    const toOr0 = main.connections!.find((c) => c.to.kind === 'instance' && c.to.instanceId === 'or1' && c.to.portId === 'in:0')
    expect(toOr0?.from).toEqual({ kind: 'instance', instanceId: compInst.id, portId: 'out:0' })
  })

  it('keeps connections that do not touch the selection untouched', () => {
    const design = buildHalfAdderDesign()
    const result = applyGroup(design, 'main', ['xor1'], ['X1', 'X2'], ['Y'])

    const main = result.defs['main']
    // srcA -> and1 (untouched by grouping xor1) must remain, from srcA still
    expect(main.connections!.some((c) => c.from.kind === 'instance' && c.from.instanceId === 'srcA' && c.to.kind === 'instance' && c.to.instanceId === 'and1')).toBe(true)
    // xor1 -> or1 rewired through the new component
    expect(main.instances!.some((i) => i.id === 'xor1')).toBe(false)
    expect(main.instances!.some((i) => i.defId === 'component')).toBe(true)
  })
})
