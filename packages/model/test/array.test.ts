import { describe, expect, it } from 'vitest'
import { arrayPorts, defaultPropsOf, primitiveDef, primitiveOf } from '../src/primitives'

describe('array primitives', () => {
  it('builds switch-array/led-array with wire defaults', () => {
    const sa = primitiveDef('switch-array')
    expect(sa.ports.map((p) => p.id)).toEqual(['out:0', 'out:1', 'out:2', 'out:3'])
    expect(sa.ports[0].direction).toBe('output')

    const la = primitiveDef('led-array')
    expect(la.ports.map((p) => p.id)).toEqual(['in:0', 'in:1', 'in:2', 'in:3'])
    expect(la.ports[0].direction).toBe('input')

    expect(defaultPropsOf('switch-array')).toEqual({ terminalType: 'wire', size: 4 })
    expect(primitiveOf('switch-array').properties().map((p) => p.name)).toEqual(['terminalType', 'size'])
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
    expect(prim.deriveWidth!(bus, new Map())).toBeNull()
    expect(prim.deriveWidth!(wire, new Map())).toBe(1)
  })
})
