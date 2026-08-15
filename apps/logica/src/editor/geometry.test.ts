import { describe, expect, it } from 'vitest'
import type { ComponentDef, Design } from '@logica/model'
import { inputPortDef, outputPortDef, primitiveDef } from '@logica/model'
import { isNeutralPin, pinWidth } from './geometry'

const iref = (instanceId: string, portId: string) => ({ instanceId, portId })

function makeBusDesign(): Design {
  const fanIn = primitiveDef('fan-in') // 2 single inputs -> 1 bus output
  const inputPort = inputPortDef()

  // A composite with a single input port (neutral until connected).
  const comp: ComponentDef = {
    id: 'comp',
    name: 'comp',
    kind: 'composite',
    ports: [{ id: 'in:0', name: 'A', direction: 'input', terminal: { instanceId: 'c-in', pinId: 'in:0' } }],
    instances: [{ id: 'c-in', name: '', defId: 'input-port', pos: { x: 0, y: 0 } }],
    connections: [],
  }

  const main: ComponentDef = {
    id: 'main',
    name: 'main',
    kind: 'composite',
    ports: [],
    instances: [
      { id: 'fi', name: 'fi', defId: 'fan-in', pos: { x: 0, y: 0 } },
      { id: 'ci', name: 'ci', defId: 'comp', pos: { x: 120, y: 0 } },
    ],
    connections: [{ id: 'w', from: iref('fi', 'out:0'), to: iref('ci', 'in:0') }],
  }

  return { version: 1, root: 'main', defs: { 'fan-in': fanIn, 'input-port': inputPort, comp, main } }
}

describe('pinWidth / isNeutralPin', () => {
  it('resolves fan-in bus width from its arity', () => {
    const design = makeBusDesign()
    expect(pinWidth(design, design.defs['main'], iref('fi', 'out:0'))).toBe(2)
    expect(pinWidth(design, design.defs['main'], iref('fi', 'in:0'))).toBe(1)
  })

  it('propagates bus width through a composite port via its connection', () => {
    const design = makeBusDesign()
    // the composite instance's input pin inherits width 2 from the fan-in
    expect(pinWidth(design, design.defs['main'], iref('ci', 'in:0'))).toBe(2)
    expect(isNeutralPin(design, design.defs['main'], iref('ci', 'in:0'))).toBe(false)
  })

  it('treats an unconnected composite port as neutral', () => {
    const design = makeBusDesign()
    const comp = design.defs['comp']
    expect(pinWidth(design, comp, iref('c-in', 'in:0'))).toBe(1)
    expect(isNeutralPin(design, comp, iref('c-in', 'in:0'))).toBe(true)
  })

  it('surfaces an internal fan-in bus on a composite output port from the outside', () => {
    const design = makeBusHolderDesign()
    const main = design.defs['main']
    // The composite's out:0 is driven internally by a 2-input fan-in, so the pin is a
    // bus even though there is no external connection.
    expect(pinWidth(design, main, iref('bh', 'out:0'))).toBe(2)
    expect(isNeutralPin(design, main, iref('bh', 'out:0'))).toBe(false)
  })

  it('keeps the internal bus width even when the outside wire is single-width', () => {
    const design = makeBusHolderDesign()
    const main = design.defs['main']
    main.connections!.push({ id: 'w', from: iref('bh', 'out:0'), to: iref('g', 'in:0') })
    // The external connection is to a single-wire gate input, but the port's own width
    // is still 2 (the connection itself would be rejected by validation as a mismatch).
    expect(pinWidth(design, main, iref('bh', 'out:0'))).toBe(2)
    expect(isNeutralPin(design, main, iref('bh', 'out:0'))).toBe(false)
  })

  it('surfaces an internal fan-out bus on a composite input port from the outside', () => {
    const design = makeBusHolderDesign()
    const main = design.defs['main']
    expect(pinWidth(design, main, iref('bh', 'in:0'))).toBe(2)
    expect(isNeutralPin(design, main, iref('bh', 'in:0'))).toBe(false)
  })
})

// A composite "bus-holder" whose single output port is driven internally by a 2-input
// fan-in (=> width 2), and whose single input port feeds a 2-output fan-out (=> width 2).
function makeBusHolderDesign(): Design {
  const fanIn = primitiveDef('fan-in') // 2 single inputs -> 1 bus output
  const fanOut = primitiveDef('fan-out') // 1 bus input -> 2 single outputs

  const busHolder: ComponentDef = {
    id: 'bus-holder',
    name: 'bus-holder',
    kind: 'composite',
    ports: [
      { id: 'in:0', name: 'BUS', direction: 'input', terminal: { instanceId: 'bh-in', pinId: 'in:0' } },
      { id: 'out:0', name: 'BUS', direction: 'output', terminal: { instanceId: 'bh-out', pinId: 'out:0' } },
    ],
    instances: [
      { id: 'bh-in', name: '', defId: 'input-port', pos: { x: 0, y: -40 } },
      { id: 'bh-out', name: '', defId: 'output-port', pos: { x: 240, y: -40 } },
      { id: 'bh-fo', name: 'fo', defId: 'fan-out', pos: { x: 120, y: -40 } },
      { id: 'bh-fi', name: 'fi', defId: 'fan-in', pos: { x: 120, y: 40 } },
    ],
    connections: [
      { id: 'c-in', from: iref('bh-in', 'in:0'), to: iref('bh-fo', 'in:0') },
      { id: 'c-out', from: iref('bh-fi', 'out:0'), to: iref('bh-out', 'out:0') },
    ],
  }

  const andGate = primitiveDef('and')

  const main: ComponentDef = {
    id: 'main',
    name: 'main',
    kind: 'composite',
    ports: [],
    instances: [
      { id: 'bh', name: 'bh', defId: 'bus-holder', pos: { x: 0, y: 0 } },
      { id: 'g', name: 'g', defId: 'and', pos: { x: 200, y: 0 } },
    ],
    connections: [],
  }

  return {
    version: 1,
    root: 'main',
    defs: { 'fan-in': fanIn, 'fan-out': fanOut, 'input-port': inputPortDef(), 'output-port': outputPortDef(), and: andGate, 'bus-holder': busHolder, main },
  }
}
