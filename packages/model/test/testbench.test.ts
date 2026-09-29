import { describe, expect, it } from 'vitest'
import type { CompositeDef, Design } from '../src/types'
import { forkOf } from '../src/primitives'
import { cloneDesign } from '../src/group'
import { parseDesign, serializeDesign } from '../src/serialize'
import { MAIN_INSTANCE_ID, TESTBENCH_COMPOSITE_ID, emptyTestbench, testbenchComposite, withTestbench } from '../src/testbench'

function rootComposite(): CompositeDef {
  return {
    id: 'main',
    name: 'main',
    kind: 'composite',
    ports: [
      { id: 'in:0', name: 'A', direction: 'input', terminal: { instanceId: 'ci', pinId: 'in:0' } },
      { id: 'out:0', name: 'Y', direction: 'output', terminal: { instanceId: 'co', pinId: 'out:0' } },
    ],
    instances: [
      { id: 'ci', name: '', def: { kind: 'builtin', primitive: 'input-port' }, pos: { x: 0, y: 0 } },
      { id: 'b', name: 'b', def: forkOf('buffer'), pos: { x: 60, y: 0 } },
      { id: 'co', name: '', def: { kind: 'builtin', primitive: 'output-port' }, pos: { x: 120, y: 0 } },
    ],
    connections: [
      { id: 'c1', from: { instanceId: 'ci', portId: 'in:0' }, to: { instanceId: 'b', portId: 'in:0' } },
      { id: 'c2', from: { instanceId: 'b', portId: 'out:0' }, to: { instanceId: 'co', portId: 'out:0' } },
    ],
  }
}

function design(): Design {
  return {
    version: 2,
    root: rootComposite(),
    library: {},
    testbench: {
      main: { pos: { x: 10, y: 20 } },
      instances: [{ id: 'sw', name: '', def: forkOf('switch-array'), pos: { x: -100, y: 0 } }],
      connections: [{ id: 't1', from: { instanceId: 'sw', portId: 'out:0' }, to: { instanceId: MAIN_INSTANCE_ID, portId: 'in:0' } }],
    },
  }
}

describe('testbench', () => {
  it('synthesizes a composite wrapping the root in a main instance', () => {
    const d = design()
    const composite = testbenchComposite(d, d.testbench!)
    expect(composite.id).toBe(TESTBENCH_COMPOSITE_ID)
    expect(composite.ports).toEqual([])
    const main = composite.instances[0]
    expect(main.id).toBe(MAIN_INSTANCE_ID)
    expect(main.name).toBe('main')
    expect(main.def).toBe(d.root)
    expect(composite.instances).toHaveLength(2)
    expect(composite.connections).toBe(d.testbench!.connections)
  })

  it('withTestbench wraps a design without a testbench in an empty one', () => {
    const d: Design = { version: 2, root: rootComposite(), library: {} }
    const wrapped = withTestbench(d)
    expect(wrapped.root.kind).toBe('composite')
    expect(wrapped.root.id).toBe(TESTBENCH_COMPOSITE_ID)
    const main = wrapped.root.instances[0]
    expect(main.id).toBe(MAIN_INSTANCE_ID)
    expect(main.def).toBe(d.root)
  })

  it('withTestbench leaves the original design root untouched', () => {
    const d = design()
    withTestbench(d)
    expect(d.root.id).toBe('main')
    expect(d.root.kind).toBe('composite')
  })

  it('cloneDesign deep-copies the testbench independently', () => {
    const d = design()
    const clone = cloneDesign(d)
    expect(clone.testbench).toBeDefined()
    expect(clone.testbench!.main).toEqual({ pos: { x: 10, y: 20 } })
    expect(clone.testbench!.instances).toHaveLength(1)
    // Not shared references.
    expect(clone.testbench!.instances[0]).not.toBe(d.testbench!.instances[0])
    expect(clone.testbench!.connections[0]).not.toBe(d.testbench!.connections[0])
  })

  it('round-trips a testbench through serialization', () => {
    const d = design()
    const parsed = parseDesign(serializeDesign(d))
    expect(parsed.testbench).toEqual(d.testbench)
  })

  it('omits the testbench key when absent (byte-stable for legacy files)', () => {
    const d: Design = { version: 2, root: rootComposite(), library: {} }
    expect(serializeDesign(d)).not.toContain('testbench')
  })

  it('emptyTestbench has no instances or connections', () => {
    expect(emptyTestbench()).toEqual({ main: { pos: { x: 0, y: 0 } }, instances: [], connections: [] })
  })
})
