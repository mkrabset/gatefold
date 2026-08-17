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
  withBuiltinPrimitives,
} from '../src/primitives'

describe('model primitives', () => {
  it('exposes the initial library of AND, OR, XOR, NOT, BUFFER, CLOCK, FAN-IN, FAN-OUT, BUS-SPLIT, BUS-MERGE', () => {
    expect(libraryPrimitives().map((p) => p.kind)).toEqual(['and', 'or', 'xor', 'not', 'buffer', 'clock', 'fan-in', 'fan-out', 'bus-split', 'bus-merge'])
  })

  it('inverts the NOT output and leaves the buffer un-inverted', () => {
    expect(outputPorts(primitiveDef('not'))[0].inverted).toBe(true)
    expect(inputPorts(primitiveDef('not'))[0].inverted).toBeUndefined()
    expect(outputPorts(primitiveDef('buffer'))[0].inverted).toBeUndefined()
    expect(inputPorts(primitiveDef('and'))[0].inverted).toBeUndefined()
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

  it('builds bus-split/bus-merge with one bus terminal on the wide side', () => {
    const split = primitiveDef('bus-split')
    expect(inputPorts(split).map((p) => p.name)).toEqual(['BUS'])
    expect(outputPorts(split).map((p) => p.name)).toEqual(['Y1', 'Y2'])

    const merge = primitiveDef('bus-merge')
    expect(inputPorts(merge).map((p) => p.name)).toEqual(['A', 'B'])
    expect(outputPorts(merge).map((p) => p.name)).toEqual(['BUS'])
  })

  it('derives bus-split/merge widths from siblings', () => {
    const split = primitiveOf('bus-split').deriveWidth!
    const in0 = inputPorts(primitiveDef('bus-split'))[0]
    const out0 = outputPorts(primitiveDef('bus-split'))[0]
    expect(split(in0, new Map([['out:0', 3]]))).toBe(6)
    expect(split(out0, new Map([['in:0', 6]]))).toBe(3)
    expect(split(out0, new Map([['out:1', 4]]))).toBe(4)
    expect(split(out0, new Map())).toBeNull()
    expect(split(out0, new Map([['in:0', 5]]))).toBe(2.5)

    const merge = primitiveOf('bus-merge').deriveWidth!
    const mOut = outputPorts(primitiveDef('bus-merge'))[0]
    const mIn0 = inputPorts(primitiveDef('bus-merge'))[0]
    expect(merge(mOut, new Map([['in:0', 3]]))).toBe(6)
    expect(merge(mIn0, new Map([['out:0', 6]]))).toBe(3)
    expect(merge(mIn0, new Map())).toBeNull()
  })

  it('provides undetermined-width hints', () => {
    const splitIn = inputPorts(primitiveDef('bus-split'))[0]
    const splitOut = outputPorts(primitiveDef('bus-split'))[0]
    expect(primitiveOf('bus-split').undeterminedHint!(splitIn)).toBe('2x?')
    expect(primitiveOf('bus-split').undeterminedHint!(splitOut)).toBe('?')

    const mergeOut = outputPorts(primitiveDef('bus-merge'))[0]
    const mergeIn = inputPorts(primitiveDef('bus-merge'))[0]
    expect(primitiveOf('bus-merge').undeterminedHint!(mergeOut)).toBe('2x?')
    expect(primitiveOf('bus-merge').undeterminedHint!(mergeIn)).toBe('?')
  })

  it('ensures built-in primitive defs are present (for older loaded designs)', () => {
    const design = {
      version: 1,
      root: 'main',
      defs: { main: { id: 'main', name: 'main', kind: 'composite' as const, ports: [], instances: [], connections: [] } },
    }
    const ensured = withBuiltinPrimitives(design)
    for (const kind of ['and', 'fan-in', 'bus-split', 'bus-merge', 'input-port', 'output-port']) {
      expect(ensured.defs[kind]).toBeDefined()
    }
    expect(ensured.defs['main']).toBe(design.defs['main'])
  })
})
