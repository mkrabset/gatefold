import { describe, expect, it } from 'vitest'
import type { ComponentDef, Design } from '@logica/model'
import { inputPortDef, primitiveDef } from '@logica/model'
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
})
