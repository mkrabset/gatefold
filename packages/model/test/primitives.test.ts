import { describe, expect, it } from 'vitest'
import { inputPortId, inputPorts, outputPortId, outputPorts } from '../src/types'
import type { Signal } from '../src/types'
import {
  allowInversion,
  arrayDirection,
  builtinOf,
  CLOCK_DEFAULT_PERIOD,
  defaultPropsOf,
  forkOf,
  invertSignal,
  isArityFixed,
  isArrayDef,
  isPortGroupDef,
  libraryPrimitives,
  periodOf,
  portWidth,
  primitiveOf,
  sevenSegDigit,
  sevenSegDigits,
  sevenSegModeOf,
  sevenSegPositionCount,
} from '../src/primitives'

const def = (kind: Parameters<typeof forkOf>[0]) => forkOf(kind)
const inP = (kind: Parameters<typeof forkOf>[0]) => inputPorts(def(kind).ports)
const outP = (kind: Parameters<typeof forkOf>[0]) => outputPorts(def(kind).ports)

describe('model primitives', () => {
  it('exposes the initial library of AND, OR, XOR, NOT, BUFFER, CLOCK, FAN-IN, FAN-OUT, BUS-SPLIT, BUS-MERGE, BUS, 7-SEG, SWITCHES, LEDS, DFF, NODE', () => {
    expect(libraryPrimitives().map((p) => p.kind)).toEqual(['and', 'or', 'xor', 'not', 'buffer', 'clock', 'fan-in', 'fan-out', 'bus-split', 'bus-merge', 'bus', 'seven-seg', 'switch-array', 'led-array', 'dff', 'join-point'])
  })

  it('recognizes the array primitives and their terminal direction', () => {
    expect(isArrayDef(def('switch-array'))).toBe(true)
    expect(isArrayDef(def('led-array'))).toBe(true)
    expect(isArrayDef(def('and'))).toBe(false)
    expect(isArrayDef(undefined)).toBe(false)
    expect(arrayDirection(def('switch-array'))).toBe('output')
    expect(arrayDirection(def('led-array'))).toBe('input')
  })

  it('resolves a 7-seg mode property, defaulting to HEX', () => {
    expect(sevenSegModeOf(undefined)).toBe('HEX')
    expect(sevenSegModeOf({})).toBe('HEX')
    expect(sevenSegModeOf({ mode: 'DEC' })).toBe('DEC')
    expect(sevenSegModeOf({ mode: 'SIGNED DEC' })).toBe('SIGNED DEC')
    expect(sevenSegModeOf({ mode: 'garbage' })).toBe('HEX')
  })

  it('resolves a clock period property, defaulting to the built-in period', () => {
    expect(periodOf(undefined)).toBe(CLOCK_DEFAULT_PERIOD)
    expect(periodOf({})).toBe(CLOCK_DEFAULT_PERIOD)
    expect(periodOf({ period: 2500 })).toBe(2500)
    expect(periodOf({ period: 'fast' })).toBe(CLOCK_DEFAULT_PERIOD)
  })

  it('inverts the NOT output and leaves the buffer un-inverted', () => {
    expect(outP('not')[0].inverted).toBe(true)
    expect(inP('not')[0].inverted).toBeUndefined()
    expect(outP('buffer')[0].inverted).toBeUndefined()
    expect(inP('and')[0].inverted).toBeUndefined()
  })

  it('builds a primitive fork with ports of the correct arity', () => {
    expect(inP('and')).toHaveLength(2)
    expect(outP('and')).toHaveLength(1)
    expect(inP('not')).toHaveLength(1)
    expect(inP('clock')).toHaveLength(0)
    expect(outP('clock')).toHaveLength(1)
  })

  it('assigns stable, ordered port ids', () => {
    expect(inP('and').map((p) => p.id)).toEqual(['in:0', 'in:1'])
    expect(outP('and').map((p) => p.id)).toEqual(['out:0'])
  })

  it('formats port ids', () => {
    expect(inputPortId(0)).toBe('in:0')
    expect(outputPortId(1)).toBe('out:1')
  })

  it('defines port-group built-ins whose pins are derived from the enclosing composite', () => {
    expect(isPortGroupDef(builtinOf('input-port'))).toBe(true)
    expect(isPortGroupDef(builtinOf('output-port'))).toBe(true)
    expect(isPortGroupDef(def('and'))).toBe(false)
  })

  it('builds fan-in/fan-out with the bus terminal and single-wire terminals', () => {
    expect(inP('fan-in')).toHaveLength(4)
    expect(outP('fan-in')).toHaveLength(1)
    expect(outP('fan-in')[0].name).toBe('BUS')

    expect(inP('fan-out')).toHaveLength(1)
    expect(inP('fan-out')[0].name).toBe('BUS')
    expect(outP('fan-out')).toHaveLength(4)
  })

  it('derives the bus width from the opposite arity', () => {
    expect(portWidth(def('fan-in'), outP('fan-in')[0])).toBe(4)
    expect(portWidth(def('fan-out'), inP('fan-out')[0])).toBe(4)
  })

  it('defaults a regular port width to 1', () => {
    expect(portWidth(def('and'), inP('and')[0])).toBe(1)
    expect(portWidth(def('and'), outP('and')[0])).toBe(1)
  })

  it('exposes arity constraints polymorphically', () => {
    expect(isArityFixed(def('and'), 'input')).toBe(false)
    expect(isArityFixed(def('and'), 'output')).toBe(true)
    expect(isArityFixed(def('fan-out'), 'input')).toBe(true)
    expect(isArityFixed(def('fan-out'), 'output')).toBe(false)
  })

  it('defines the NODE join-point with coincident single-wire terminals', () => {
    expect(inP('join-point').map((p) => p.id)).toEqual(['in:0'])
    expect(outP('join-point').map((p) => p.id)).toEqual(['out:0'])
    expect(isArityFixed(def('join-point'), 'input')).toBe(true)
    expect(isArityFixed(def('join-point'), 'output')).toBe(true)
    expect(primitiveOf('join-point').coincidentTerminals?.()).toBe(true)
    expect(allowInversion(def('join-point'))).toBe(false)
    expect(allowInversion(def('and'))).toBe(true)
    expect(portWidth(def('join-point'), inP('join-point')[0])).toBe(1)
    expect(portWidth(def('join-point'), outP('join-point')[0])).toBe(1)
    expect(defaultPropsOf('join-point')).toEqual({})
  })

  it('resolves one behaviour object per kind', () => {
    expect(primitiveOf('and').label).toBe('AND')
    expect(primitiveOf('fan-in').bodySize()).toEqual({ w: 56, h: 48 })
    expect(primitiveOf('clock').fixedInputs).toBe(true)
  })

  it('declares the clock period property with unit and default', () => {
    expect(primitiveOf('clock').properties()).toEqual([
      { name: 'period', label: 'Period', type: 'number', default: 10_000_000, unit: 'ps', min: 1 },
    ])
    expect(defaultPropsOf('clock')).toEqual({ period: 10_000_000 })
  })

  it('declares the bus lanes property and fixes the terminal width to it', () => {
    expect(inP('bus')).toHaveLength(1)
    expect(outP('bus')).toHaveLength(1)
    expect(primitiveOf('bus').properties()).toEqual([
      { name: 'lanes', label: 'Lanes', type: 'number', default: 8, min: 1, max: 32 },
    ])
    expect(defaultPropsOf('bus')).toEqual({ lanes: 8 })

    const prim = primitiveOf('bus')
    const ports = def('bus').ports
    const input = inP('bus')[0]
    const output = outP('bus')[0]
    expect(prim.intrinsicWidth(ports, input, { lanes: 8 })).toBe(8)
    expect(prim.intrinsicWidth(ports, output, { lanes: 8 })).toBe(8)
    expect(prim.intrinsicWidth(ports, input)).toBe(8)
    expect(prim.intrinsicWidth(ports, input, { lanes: 3.5 })).toBe(3)
  })

  it('passes a bus through unchanged', () => {
    expect(primitiveOf('bus').transfer([[1, 0, 1, 0]])).toEqual([[1, 0, 1, 0]])
  })

  it('declares the seven-seg mode/order properties and a single neutral bus input', () => {
    expect(inP('seven-seg').map((p) => p.id)).toEqual(['in:0'])
    expect(inP('seven-seg')[0].name).toBe('BUS')
    expect(outP('seven-seg')).toHaveLength(0)

    expect(primitiveOf('seven-seg').properties()).toEqual([
      { name: 'mode', label: 'Mode', type: 'select', default: 'HEX', options: ['HEX', 'DEC', 'SIGNED DEC'] },
      { name: 'order', label: 'Order', type: 'select', default: 'asc', options: ['asc', 'desc'] },
    ])
    expect(defaultPropsOf('seven-seg')).toEqual({ mode: 'HEX', order: 'asc' })

    const prim = primitiveOf('seven-seg')
    const input = inP('seven-seg')[0]
    expect(prim.intrinsicWidth(def('seven-seg').ports, input)).toBeNull()
    expect(prim.widthError!(input, 4)).toBeNull()
    expect(prim.widthError!(input, 8)).toBeNull()
    expect(prim.widthError!(input, 6)).toBe('7-seg width must be a multiple of 4')
    expect(prim.widthError!(input, 68)).toBe('7-seg width must be at most 64 lanes')
  })

  it('decodes seven-seg values in HEX, DEC and SIGNED DEC modes', () => {
    const zero = [1, 1, 1, 1, 1, 1, 0]
    const one = [0, 1, 1, 0, 0, 0, 0]
    const d4 = [0, 1, 1, 0, 0, 1, 1] // digit 4
    const d2 = [1, 1, 0, 1, 1, 0, 1] // digit 2

    const hexBits: Signal[] = [1, 1, 1, 1, 1, 0, 0, 0]
    expect(sevenSegDigits(hexBits, 'HEX')).toEqual([one, sevenSegDigit([1, 1, 1, 1] as Signal[])])

    const decBits: Signal[] = [0, 1, 0, 1, 0, 1, 0, 0]
    expect(sevenSegDigits(decBits, 'DEC')).toEqual([null, d4, d2])
    expect(sevenSegPositionCount(8, 'DEC')).toBe(3)

    const negBits: Signal[] = [0, 1, 1, 0, 1, 0, 1, 1]
    expect(sevenSegDigits(negBits, 'SIGNED DEC')).toEqual([[0, 0, 0, 0, 0, 0, 1], null, d4, d2])
    expect(sevenSegPositionCount(8, 'SIGNED DEC')).toBe(4)

    expect(sevenSegDigits([0, 0, 0, 0, 0, 0, 0, 0] as Signal[], 'DEC')).toEqual([null, null, zero])
  })

  it('folds an empty property list into an empty defaults record', () => {
    expect(primitiveOf('and').properties()).toEqual([])
    expect(defaultPropsOf('and')).toEqual({})
  })

  it('declares the DFF as a sequential primitive with D/CLK/RST/Q/!Q', () => {
    expect(inP('dff').map((p) => p.name)).toEqual(['D', 'CLK', 'RST'])
    expect(inP('dff').map((p) => p.id)).toEqual(['in:0', 'in:1', 'in:2'])
    expect(outP('dff').map((p) => p.name)).toEqual(['Q', '!Q'])
    expect(outP('dff').map((p) => p.id)).toEqual(['out:0', 'out:1'])
    expect(outP('dff')[1].inverted).toBeUndefined()
    expect(isArityFixed(def('dff'), 'input')).toBe(true)
    expect(isArityFixed(def('dff'), 'output')).toBe(true)

    const prim = primitiveOf('dff')
    expect(prim.isSequential()).toBe(true)
    expect(prim.clockPortId?.()).toBe('in:1')
    expect(prim.resetPortId?.()).toBe('in:2')
    expect(prim.complementPortId?.()).toBe('out:1')
    expect(prim.properties()).toEqual([
      { name: 'edge', label: 'Edge', type: 'select', default: 'posedge', options: ['posedge', 'negedge'] },
      { name: 'initialValue', label: 'Initial value', type: 'boolean', default: false },
      { name: 'resetActiveHigh', label: 'Active-high reset', type: 'boolean', default: true },
    ])
    expect(defaultPropsOf('dff')).toEqual({ edge: 'posedge', initialValue: false, resetActiveHigh: true })
    expect(portWidth(def('dff'), inP('dff')[0])).toBe(1)
  })

  it('marks ordinary gates as non-sequential', () => {
    expect(primitiveOf('and').isSequential()).toBe(false)
    expect(primitiveOf('clock').isSequential()).toBe(false)
    expect(primitiveOf('input-port').isSequential()).toBe(false)
  })

  it('inverts a single signal in 3-state', () => {
    expect(invertSignal(0)).toBe(1)
    expect(invertSignal(1)).toBe(0)
    expect(invertSignal('x')).toBe('x')
  })

  it('builds bus-split/bus-merge with one bus terminal on the wide side', () => {
    expect(inP('bus-split').map((p) => p.name)).toEqual(['BUS'])
    expect(outP('bus-split').map((p) => p.name)).toEqual(['Y1', 'Y2'])

    expect(inP('bus-merge').map((p) => p.name)).toEqual(['A', 'B'])
    expect(outP('bus-merge').map((p) => p.name)).toEqual(['BUS'])
  })

  it('derives bus-split/merge widths from siblings', () => {
    const split = primitiveOf('bus-split').deriveWidth!
    const in0 = inP('bus-split')[0]
    const out0 = outP('bus-split')[0]
    expect(split(in0, new Map([['out:0', 3]]))).toBe(6)
    expect(split(out0, new Map([['in:0', 6]]))).toBe(3)
    expect(split(out0, new Map([['out:1', 4]]))).toBe(4)
    expect(split(out0, new Map())).toBeNull()
    expect(split(out0, new Map([['in:0', 5]]))).toBe(2.5)

    const merge = primitiveOf('bus-merge').deriveWidth!
    const mOut = outP('bus-merge')[0]
    const mIn0 = inP('bus-merge')[0]
    expect(merge(mOut, new Map([['in:0', 3]]))).toBe(6)
    expect(merge(mIn0, new Map([['out:0', 6]]))).toBe(3)
    expect(merge(mIn0, new Map())).toBeNull()
  })

  it('provides undetermined-width hints', () => {
    const splitIn = inP('bus-split')[0]
    const splitOut = outP('bus-split')[0]
    expect(primitiveOf('bus-split').undeterminedHint!(splitIn)).toBe('2x?')
    expect(primitiveOf('bus-split').undeterminedHint!(splitOut)).toBe('?')

    const mergeOut = outP('bus-merge')[0]
    const mergeIn = inP('bus-merge')[0]
    expect(primitiveOf('bus-merge').undeterminedHint!(mergeOut)).toBe('2x?')
    expect(primitiveOf('bus-merge').undeterminedHint!(mergeIn)).toBe('?')
  })
})
