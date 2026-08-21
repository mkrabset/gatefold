import { describe, expect, it } from 'vitest'
import type { ComponentDef, Design } from '../src/types'
import { arrayPorts, defaultPropsOf, primitiveDef, primitiveOf } from '../src/primitives'
import { connectionError } from '../src/widths'

describe('array primitives', () => {
  it('builds switch-array/led-array with wire defaults', () => {
    const sa = primitiveDef('switch-array')
    expect(sa.ports.map((p) => p.id)).toEqual(['out:0'])
    expect(sa.ports[0].direction).toBe('output')

    const la = primitiveDef('led-array')
    expect(la.ports.map((p) => p.id)).toEqual(['in:0'])
    expect(la.ports[0].direction).toBe('input')

    expect(defaultPropsOf('switch-array')).toEqual({ terminalType: 'wire' })
    expect(primitiveOf('switch-array').properties().map((p) => p.name)).toEqual(['terminalType'])
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
    const main: ComponentDef = {
      id: 'main',
      name: 'main',
      kind: 'composite',
      ports: [],
      instances: [
        { id: 'sa', name: 'sa', defId: 'switch-array', pos: { x: 0, y: 0 } },
        { id: 'fo', name: 'fo', defId: 'fan-out', pos: { x: 100, y: 0 } },
      ],
      connections: [],
    }
    const design: Design = {
      version: 1,
      root: 'main',
      defs: { 'switch-array': primitiveDef('switch-array'), 'fan-out': primitiveDef('fan-out'), main },
    }
    // sa.out:0 is width 1; fo.in:0 is a bus (width = 2 outputs).
    expect(connectionError(design, main, { instanceId: 'sa', portId: 'out:0' }, { instanceId: 'fo', portId: 'in:0' })).toBe('Bus width mismatch')
  })

  it('BUS fixes the width of its terminals to the lanes property', () => {
    const main: ComponentDef = {
      id: 'main',
      name: 'main',
      kind: 'composite',
      ports: [],
      instances: [
        { id: 'b', name: 'b', defId: 'bus', pos: { x: 0, y: 0 }, props: { lanes: 8 } },
        { id: 'and', name: 'and', defId: 'and', pos: { x: 100, y: 0 } },
      ],
      connections: [],
    }
    const design: Design = {
      version: 1,
      root: 'main',
      defs: { bus: primitiveDef('bus'), and: primitiveDef('and'), main },
    }
    // b.out:0 is fixed width 8; and.in:0 is width 1 → mismatch.
    expect(connectionError(design, main, { instanceId: 'b', portId: 'out:0' }, { instanceId: 'and', portId: 'in:0' })).toBe('Bus width mismatch')
  })
})
