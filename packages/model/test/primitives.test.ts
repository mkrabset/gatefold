import { describe, expect, it } from 'vitest'
import { inputPortId, inputPorts, outputPortId, outputPorts } from '../src/types'
import { PRIMITIVE_LIBRARY, inputPortDef, outputPortDef, primitiveDef } from '../src/primitives'

describe('model primitives', () => {
  it('exposes the initial library of AND, OR, XOR, NOT, CLOCK', () => {
    expect(PRIMITIVE_LIBRARY.map((p) => p.kind)).toEqual(['and', 'or', 'xor', 'not', 'clock'])
  })

  it('builds a primitive def with ports of the correct arity', () => {
    expect(inputPorts(primitiveDef('and'))).toHaveLength(2)
    expect(outputPorts(primitiveDef('and'))).toHaveLength(1)
    expect(inputPorts(primitiveDef('not'))).toHaveLength(1)
    expect(inputPorts(primitiveDef('clock'))).toHaveLength(0)
    expect(outputPorts(primitiveDef('clock'))).toHaveLength(1)
  })

  it('assigns stable, ordered port ids', () => {
    expect(inputPorts(primitiveDef('and')).map((p) => p.id)).toEqual(['in:0', 'in:1'])
    expect(outputPorts(primitiveDef('and')).map((p) => p.id)).toEqual(['out:0'])
  })

  it('formats port ids', () => {
    expect(inputPortId(0)).toBe('in:0')
    expect(outputPortId(1)).toBe('out:1')
  })

  it('defines port primitives whose pins are derived from the enclosing composite', () => {
    expect(inputPortDef().ports).toEqual([])
    expect(outputPortDef().ports).toEqual([])
  })
})
