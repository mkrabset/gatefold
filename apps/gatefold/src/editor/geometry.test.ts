import { describe, expect, it } from 'vitest'
import type { ComponentDef, CompositeDef, Design, Port } from '@gatefold/model'
import { inputPortDef, outputPortDef, primitiveDef } from '@gatefold/model'
import { defBodySize, instanceBodySize, isNeutralPin, pinRadiusWorld, pinWidth, portPosition, sideHeight, sidePinOffset } from './geometry'
import { connectionError } from '@gatefold/model'

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

  return { version: 1, root: 'main', library: {}, defs: { 'fan-in': fanIn, 'input-port': inputPort, comp, main } }
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
    const main = design.defs['main'] as CompositeDef
    // The composite's out:0 is driven internally by a 2-input fan-in, so the pin is a
    // bus even though there is no external connection.
    expect(pinWidth(design, main, iref('bh', 'out:0'))).toBe(2)
    expect(isNeutralPin(design, main, iref('bh', 'out:0'))).toBe(false)
  })

  it('keeps the internal bus width even when the outside wire is single-width', () => {
    const design = makeBusHolderDesign()
    const main = design.defs['main'] as CompositeDef
    main.connections!.push({ id: 'w', from: iref('bh', 'out:0'), to: iref('g', 'in:0') })
    // The external connection is to a single-wire gate input, but the port's own width
    // is still 2 (the connection itself would be rejected by validation as a mismatch).
    expect(pinWidth(design, main, iref('bh', 'out:0'))).toBe(2)
    expect(isNeutralPin(design, main, iref('bh', 'out:0'))).toBe(false)
  })

  it('surfaces an internal fan-out bus on a composite input port from the outside', () => {
    const design = makeBusHolderDesign()
    const main = design.defs['main'] as CompositeDef
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
    library: {},
    defs: { 'fan-in': fanIn, 'fan-out': fanOut, 'input-port': inputPortDef(), 'output-port': outputPortDef(), and: andGate, 'bus-holder': busHolder, main },
  }
}

function makeFanIn(n: number): ComponentDef {
  const ports: Port[] = []
  for (let i = 0; i < n; i++) ports.push({ id: `in:${i}`, name: `A${i}`, direction: 'input' })
  ports.push({ id: 'out:0', name: 'BUS', direction: 'output' })
  return { id: `fan-in-${n}`, name: 'FAN-IN', kind: 'primitive', primitive: 'fan-in', ports }
}

// fan-in(n) -> bus-merge -> bus-split
function makeRelationDesign(n: number): Design {
  const fanIn = makeFanIn(n)
  const split = primitiveDef('bus-split')
  const merge = primitiveDef('bus-merge')
  const main: ComponentDef = {
    id: 'main',
    name: 'main',
    kind: 'composite',
    ports: [],
    instances: [
      { id: 'fi', name: 'fi', defId: fanIn.id, pos: { x: 0, y: 0 } },
      { id: 'bm', name: 'bm', defId: 'bus-merge', pos: { x: 100, y: 0 } },
      { id: 'bs', name: 'bs', defId: 'bus-split', pos: { x: 200, y: 0 } },
    ],
    connections: [
      { id: 'c1', from: iref('fi', 'out:0'), to: iref('bm', 'in:0') },
      { id: 'c2', from: iref('bm', 'out:0'), to: iref('bs', 'in:0') },
    ],
  }
  return { version: 1, root: 'main', library: {}, defs: { [fanIn.id]: fanIn, 'bus-split': split, 'bus-merge': merge, main } }
}

describe('bus-split / bus-merge derived width', () => {
  it('propagates width through a merge→split chain', () => {
    const design = makeRelationDesign(6)
    const main = design.defs['main'] as CompositeDef
    expect(pinWidth(design, main, iref('fi', 'out:0'))).toBe(6)
    expect(pinWidth(design, main, iref('bm', 'in:0'))).toBe(6)
    expect(pinWidth(design, main, iref('bm', 'in:1'))).toBe(6)
    expect(pinWidth(design, main, iref('bm', 'out:0'))).toBe(12)
    expect(pinWidth(design, main, iref('bs', 'in:0'))).toBe(12)
    expect(pinWidth(design, main, iref('bs', 'out:0'))).toBe(6)
    expect(pinWidth(design, main, iref('bs', 'out:1'))).toBe(6)
    expect(isNeutralPin(design, main, iref('bs', 'out:0'))).toBe(false)
  })

  it('leaves an unwired merge→split chain undetermined (neutral)', () => {
    const design = makeRelationDesign(6)
    const main = design.defs['main'] as CompositeDef
    main.connections = [{ id: 'c2', from: iref('bm', 'out:0'), to: iref('bs', 'in:0') }]
    expect(isNeutralPin(design, main, iref('bm', 'out:0'))).toBe(true)
    expect(isNeutralPin(design, main, iref('bs', 'in:0'))).toBe(true)
    expect(pinWidth(design, main, iref('bm', 'out:0'))).toBe(1)
  })

  it('rejects an odd-width bus feeding a splitter input', () => {
    const fanIn = makeFanIn(5)
    const split = primitiveDef('bus-split')
    const main: ComponentDef = {
      id: 'main', name: 'main', kind: 'composite', ports: [],
      instances: [
        { id: 'fi', name: 'fi', defId: fanIn.id, pos: { x: 0, y: 0 } },
        { id: 'bs', name: 'bs', defId: 'bus-split', pos: { x: 100, y: 0 } },
      ],
      connections: [],
    }
    const design: Design = { version: 1, root: 'main', library: {}, defs: { [fanIn.id]: fanIn, 'bus-split': split, main } }
    expect(connectionError(design, main, iref('fi', 'out:0'), iref('bs', 'in:0'))).toBe('Bus width must be even')
  })

  it('accepts an even-width bus feeding a splitter input', () => {
    const fanIn = makeFanIn(6)
    const split = primitiveDef('bus-split')
    const main: ComponentDef = {
      id: 'main', name: 'main', kind: 'composite', ports: [],
      instances: [
        { id: 'fi', name: 'fi', defId: fanIn.id, pos: { x: 0, y: 0 } },
        { id: 'bs', name: 'bs', defId: 'bus-split', pos: { x: 100, y: 0 } },
      ],
      connections: [],
    }
    const design: Design = { version: 1, root: 'main', library: {}, defs: { [fanIn.id]: fanIn, 'bus-split': split, main } }
    expect(connectionError(design, main, iref('fi', 'out:0'), iref('bs', 'in:0'))).toBeNull()
  })
})

describe('dynamic body sizing', () => {
  it('stacks terminal markers with a constant gap and fixed padding', () => {
    expect(sideHeight([])).toBe(0)
    expect(sideHeight([1])).toBe(2 * 6 + 2 * pinRadiusWorld(1))
    expect(sideHeight([1, 1])).toBe(2 * 6 + 4 * pinRadiusWorld(1) + 4)
  })

  it('keeps the gap between adjacent markers constant regardless of arity', () => {
    const widths = [16, 1, 1]
    const y = widths.map((_, i) => sidePinOffset(widths, i))
    const gap = (i: number, j: number) => y[j] - pinRadiusWorld(widths[j]) - (y[i] + pinRadiusWorld(widths[i]))
    expect(gap(0, 1)).toBe(4)
    expect(gap(1, 2)).toBe(4)
  })

  it('grows a bus-split body and spaces its outputs for high arity', () => {
    const design = makeRelationDesign(32)
    const main = design.defs['main'] as CompositeDef
    const bs = main.instances!.find((i) => i.id === 'bs')!
    const def = design.defs[bs.defId]

    const base = defBodySize(def)
    const eff = instanceBodySize(design, main, bs, def)
    expect(eff.h).toBeGreaterThan(base.h)

    const p0 = portPosition(design, main, bs, def, 'out:0')
    const p1 = portPosition(design, main, bs, def, 'out:1')
    const r = pinRadiusWorld(pinWidth(design, main, { instanceId: bs.id, portId: 'out:0' }))
    // No overlap between the two bus outputs.
    expect(Math.abs(p1.y - p0.y)).toBeGreaterThanOrEqual(2 * r)
    // The top/bottom pins stay inside the grown body.
    expect(p0.y - (bs.pos.y - eff.h / 2)).toBeGreaterThanOrEqual(r)
    expect((bs.pos.y + eff.h / 2) - p1.y).toBeGreaterThanOrEqual(r)
  })

  it('keeps the default size when all pins are single-wire', () => {
    const design = makeBusDesign()
    const main = design.defs['main'] as CompositeDef
    const fi = main.instances!.find((i) => i.id === 'fi')!
    const def = design.defs[fi.defId]
    expect(instanceBodySize(design, main, fi, def)).toEqual(defBodySize(def))
  })
})
