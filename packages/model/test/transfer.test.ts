import { describe, expect, it } from 'vitest'
import type { Signal } from '../src/types'
import { primitiveOf } from '../src/primitives'

const s = (v: Signal): Signal[] => [v]

describe('primitive transfer (combinational 3-state logic)', () => {
  it('AND — 0 dominates, x propagates otherwise', () => {
    const and = primitiveOf('and').transfer
    expect(and([[1], [1]])).toEqual([[1]])
    expect(and([[0], [1]])).toEqual([[0]])
    expect(and([[1], [0]])).toEqual([[0]])
    expect(and([['x'], [1]])).toEqual([['x']])
    expect(and([[0], ['x']])).toEqual([[0]])
  })

  it('OR — 1 dominates, x propagates otherwise', () => {
    const or = primitiveOf('or').transfer
    expect(or([[0], [0]])).toEqual([[0]])
    expect(or([[1], [0]])).toEqual([[1]])
    expect(or([[0], [1]])).toEqual([[1]])
    expect(or([['x'], [0]])).toEqual([['x']])
    expect(or([[1], ['x']])).toEqual([[1]])
  })

  it('XOR — parity, x propagates', () => {
    const xor = primitiveOf('xor').transfer
    expect(xor([[0], [1]])).toEqual([[1]])
    expect(xor([[1], [1]])).toEqual([[0]])
    expect(xor([[1], [0], [1]])).toEqual([[0]])
    expect(xor([['x'], [1]])).toEqual([['x']])
  })

  it('BUFFER passes its input through (inversion is engine-side)', () => {
    const buf = primitiveOf('buffer').transfer
    expect(buf([[1]])).toEqual([[1]])
    expect(buf([[0]])).toEqual([[0]])
    expect(buf([['x']])).toEqual([['x']])
  })

  it('FAN-IN bundles single-wire inputs into one bus', () => {
    expect(primitiveOf('fan-in').transfer([[1], [0], [1]])).toEqual([[1, 0, 1]])
  })

  it('FAN-OUT splits a bus into single-wire outputs', () => {
    expect(primitiveOf('fan-out').transfer([[1, 0, 1]])).toEqual([[1], [0], [1]])
  })

  it('BUS-SPLIT splits a bus into two halves', () => {
    expect(primitiveOf('bus-split').transfer([[1, 0, 1, 0]])).toEqual([[1, 0], [1, 0]])
  })

  it('BUS-MERGE concatenates two buses', () => {
    expect(primitiveOf('bus-merge').transfer([[1, 0], [0, 1]])).toEqual([[1, 0, 0, 1]])
  })

  it('sources and sinks have no combinational transfer', () => {
    expect(primitiveOf('clock').transfer([])).toEqual([])
    expect(primitiveOf('switch-array').transfer([])).toEqual([])
    expect(primitiveOf('led-array').transfer([s('x')])).toEqual([])
    expect(primitiveOf('seven-seg').transfer([s('x'), s('x'), s('x'), s('x')])).toEqual([])
    expect(primitiveOf('input-port').transfer([])).toEqual([])
    expect(primitiveOf('output-port').transfer([])).toEqual([])
  })
})
