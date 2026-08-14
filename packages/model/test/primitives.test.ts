import { describe, expect, it } from 'vitest'
import { inputPortId, outputPortId } from '../src/types'
import { PRIMITIVE_LIBRARY, primitiveDef } from '../src/primitives'

describe('model primitives', () => {
  it('exposes the initial library of AND, OR, XOR, NOT, CLOCK', () => {
    expect(PRIMITIVE_LIBRARY.map((p) => p.kind)).toEqual(['and', 'or', 'xor', 'not', 'clock'])
  })

  it('builds a primitive def with the correct arity', () => {
    expect(primitiveDef('and').inputs).toBe(2)
    expect(primitiveDef('not').inputs).toBe(1)
    expect(primitiveDef('clock').inputs).toBe(0)
    expect(primitiveDef('clock').outputs).toBe(1)
  })

  it('formats port ids', () => {
    expect(inputPortId(0)).toBe('in:0')
    expect(outputPortId(1)).toBe('out:1')
  })
})
