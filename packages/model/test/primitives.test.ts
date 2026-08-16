import { describe, expect, it } from 'vitest'
import { inputPortId, inputPorts, outputPortId, outputPorts } from '../src/types'
import {
  defaultPropsOf,
  inputPortDef,
  isArityFixed,
  isPortGroupDef,
  libraryPrimitives,
  outputPortDef,
  portWidth,
  primitiveDef,
  primitiveOf,
} from '../src/primitives'

describe('model primitives', () => {
  it('exposes the initial library of AND, OR, XOR, NOT, CLOCK, FAN-IN, FAN-OUT', () => {
    expect(libraryPrimitives().map((p) => p.kind)).toEqual(['and', 'or', 'xor', 'not', 'clock', 'fan-in', 'fan-out'])
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
    expect(isPortGroupDef(inputPortDef())).toBe(true)
    expect(isPortGroupDef(outputPortDef())).toBe(true)
    expect(isPortGroupDef(primitiveDef('and'))).toBe(false)
  })

  it('builds fan-in/fan-out with the bus terminal and single-wire terminals', () => {
    const fanIn = primitiveDef('fan-in')
    expect(inputPorts(fanIn)).toHaveLength(2)
    expect(outputPorts(fanIn)).toHaveLength(1)
    expect(outputPorts(fanIn)[0].name).toBe('BUS')

    const fanOut = primitiveDef('fan-out')
    expect(inputPorts(fanOut)).toHaveLength(1)
    expect(inputPorts(fanOut)[0].name).toBe('BUS')
    expect(outputPorts(fanOut)).toHaveLength(2)
  })

  it('derives the bus width from the opposite arity', () => {
    const fanIn = primitiveDef('fan-in')
    expect(portWidth(fanIn, outputPorts(fanIn)[0])).toBe(2)
    const fanOut = primitiveDef('fan-out')
    expect(portWidth(fanOut, inputPorts(fanOut)[0])).toBe(2)
  })

  it('defaults a regular port width to 1', () => {
    const and = primitiveDef('and')
    expect(portWidth(and, inputPorts(and)[0])).toBe(1)
    expect(portWidth(and, outputPorts(and)[0])).toBe(1)
  })

  it('exposes arity constraints polymorphically', () => {
    expect(isArityFixed(primitiveDef('and'), 'input')).toBe(false)
    expect(isArityFixed(primitiveDef('and'), 'output')).toBe(true)
    expect(isArityFixed(primitiveDef('fan-out'), 'input')).toBe(true)
    expect(isArityFixed(primitiveDef('fan-out'), 'output')).toBe(false)
  })

  it('resolves one behaviour object per kind', () => {
    expect(primitiveOf('and').label).toBe('AND')
    expect(primitiveOf('fan-in').bodySize()).toEqual({ w: 56, h: 48 })
    expect(primitiveOf('clock').fixedInputs).toBe(true)
  })

  it('declares the clock period property with unit and default', () => {
    expect(primitiveOf('clock').properties()).toEqual([
      { name: 'period', label: 'Period', type: 'number', default: 1000, unit: 'ms', min: 1 },
    ])
    expect(defaultPropsOf('clock')).toEqual({ period: 1000 })
  })

  it('folds an empty property list into an empty defaults record', () => {
    expect(primitiveOf('and').properties()).toEqual([])
    expect(defaultPropsOf('and')).toEqual({})
  })
})
