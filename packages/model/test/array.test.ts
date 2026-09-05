import { describe, expect, it } from 'vitest'
import type { ChildDef, CompositeDef, Instance } from '../src/types'
import { arrayPorts, defaultPropsOf, forkOf, primitiveOf } from '../src/primitives'
import { connectionError } from '../src/widths'

const inst = (id: string, def: ChildDef, x = 0, y = 0, props?: Instance['props']): Instance => ({
  id,
  name: id,
  def,
  pos: { x, y },
  ...(props ? { props } : {}),
})

describe('array primitives', () => {
  it('builds switch-array/led-array with bus defaults', () => {
    const sa = forkOf('switch-array')
    expect(sa.ports.map((p) => p.id)).toEqual(['out:0'])
    expect(sa.ports[0].direction).toBe('output')

    const la = forkOf('led-array')
    expect(la.ports.map((p) => p.id)).toEqual(['in:0'])
    expect(la.ports[0].direction).toBe('input')

    expect(defaultPropsOf('switch-array')).toEqual({ terminalType: 'bus', initialValue: false, valueFormat: 'HEX', order: 'asc' })
    expect(primitiveOf('switch-array').properties().map((p) => p.name)).toEqual(['terminalType', 'initialValue', 'valueFormat', 'order'])
  })

  it('arrayPorts produces wire lanes or a single bus', () => {
    expect(arrayPorts('output', 'wire', 4).map((p) => p.id)).toEqual(['out:0', 'out:1', 'out:2', 'out:3'])
    expect(arrayPorts('output', 'bus', 4)).toEqual([{ id: 'out:0', name: 'BUS', direction: 'output' }])
    expect(arrayPorts('input', 'wire', 2).map((p) => p.id)).toEqual(['in:0', 'in:1'])
  })

  it('treats the BUS terminal as neutral and WIRE terminals as width 1', () => {
    const prim = primitiveOf('switch-array')
    const bus = { id: 'out:0', name: 'BUS', direction: 'output' as const }
    const wire = { id: 'out:0', name: 'Y0', direction: 'output' as const }
    expect(prim.intrinsicWidth([bus], bus)).toBeNull()
    expect(prim.intrinsicWidth([wire], wire)).toBe(1)
  })

  it('rejects connecting a WIRE terminal to a bus of a different width', () => {
    const main: CompositeDef = {
      id: 'main',
      name: 'main',
      kind: 'composite',
      ports: [],
      instances: [
        inst('sa', { kind: 'fork', primitive: 'switch-array', ports: arrayPorts('output', 'wire', 1) }),
        inst('fo', forkOf('fan-out'), 100, 0),
      ],
      connections: [],
    }
    expect(connectionError(main, { instanceId: 'sa', portId: 'out:0' }, { instanceId: 'fo', portId: 'in:0' })).toBe('Bus width mismatch')
  })

  it('BUS fixes the width of its terminals to the lanes property', () => {
    const main: CompositeDef = {
      id: 'main',
      name: 'main',
      kind: 'composite',
      ports: [],
      instances: [
        inst('b', forkOf('bus'), 0, 0, { lanes: 8 }),
        inst('and', forkOf('and'), 100, 0),
      ],
      connections: [],
    }
    expect(connectionError(main, { instanceId: 'b', portId: 'out:0' }, { instanceId: 'and', portId: 'in:0' })).toBe('Bus width mismatch')
  })

  it('rejects a bus width that is not a multiple of 4 for seven-seg', () => {
    const main: CompositeDef = {
      id: 'main',
      name: 'main',
      kind: 'composite',
      ports: [],
      instances: [
        inst('b', forkOf('bus'), 0, 0, { lanes: 6 }),
        inst('seg', forkOf('seven-seg'), 100, 0),
      ],
      connections: [],
    }
    expect(connectionError(main, { instanceId: 'b', portId: 'out:0' }, { instanceId: 'seg', portId: 'in:0' })).toBe('7-seg width must be a multiple of 4')
  })

  it('rejects a bus wider than 64 lanes for seven-seg', () => {
    const main: CompositeDef = {
      id: 'main',
      name: 'main',
      kind: 'composite',
      ports: [],
      instances: [
        inst('b', forkOf('bus'), 0, 0, { lanes: 68 }),
        inst('seg', forkOf('seven-seg'), 100, 0),
      ],
      connections: [],
    }
    expect(connectionError(main, { instanceId: 'b', portId: 'out:0' }, { instanceId: 'seg', portId: 'in:0' })).toBe('7-seg width must be at most 64 lanes')
  })
})
