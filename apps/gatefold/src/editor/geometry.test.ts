import { describe, expect, it } from 'vitest'
import type { ChildDef, CompositeDef, Design, Port } from '@gatefold/model'
import { builtinOf, connectionError, forkOf } from '@gatefold/model'
import { defBodySize, instanceBodySize, isNeutralPin, pinRadiusWorld, pinWidth, portPosition, sideHeight, sidePinOffset } from './geometry'

const iref = (instanceId: string, portId: string) => ({ instanceId, portId })
const gate = (id: string, kind: Parameters<typeof forkOf>[0], x = 0, y = 0) => ({ id, name: id, def: forkOf(kind), pos: { x, y } })
const gateDef = (id: string, def: ChildDef, x = 0, y = 0) => ({ id, name: id, def, pos: { x, y } })
const pg = (id: string, kind: 'input-port' | 'output-port', x = 0, y = 0) => ({ id, name: '', def: builtinOf(kind), pos: { x, y } })

function makeBusDesign(): Design {
  const comp: CompositeDef = {
    id: 'comp',
    name: 'comp',
    kind: 'composite',
    ports: [{ id: 'in:0', name: 'A', direction: 'input', terminal: { instanceId: 'c-in', pinId: 'in:0' } }],
    instances: [pg('c-in', 'input-port')],
    connections: [],
  }

  const main: CompositeDef = {
    id: 'main',
    name: 'main',
    kind: 'composite',
    ports: [],
    instances: [gateDef('fi', makeFanIn(2)), { id: 'ci', name: 'ci', def: comp, pos: { x: 120, y: 0 } }],
    connections: [{ id: 'w', from: iref('fi', 'out:0'), to: iref('ci', 'in:0') }],
  }

  return { version: 2, root: main, library: {} }
}

describe('pinWidth / isNeutralPin', () => {
  it('resolves fan-in bus width from its arity', () => {
    const design = makeBusDesign()
    expect(pinWidth(design.root, iref('fi', 'out:0'))).toBe(2)
    expect(pinWidth(design.root, iref('fi', 'in:0'))).toBe(1)
  })

  it('propagates bus width through a composite port via its connection', () => {
    const design = makeBusDesign()
    expect(pinWidth(design.root, iref('ci', 'in:0'))).toBe(2)
    expect(isNeutralPin(design.root, iref('ci', 'in:0'))).toBe(false)
  })

  it('treats an unconnected composite port as neutral', () => {
    const design = makeBusDesign()
    const comp = design.root.instances.find((i) => i.id === 'ci')!.def as CompositeDef
    expect(pinWidth(comp, iref('c-in', 'in:0'))).toBe(1)
    expect(isNeutralPin(comp, iref('c-in', 'in:0'))).toBe(true)
  })

  it('surfaces an internal fan-in bus on a composite output port from the outside', () => {
    const design = makeBusHolderDesign()
    const main = design.root
    expect(pinWidth(main, iref('bh', 'out:0'))).toBe(2)
    expect(isNeutralPin(main, iref('bh', 'out:0'))).toBe(false)
  })

  it('keeps the internal bus width even when the outside wire is single-width', () => {
    const design = makeBusHolderDesign()
    const main = design.root
    main.connections.push({ id: 'w', from: iref('bh', 'out:0'), to: iref('g', 'in:0') })
    expect(pinWidth(main, iref('bh', 'out:0'))).toBe(2)
    expect(isNeutralPin(main, iref('bh', 'out:0'))).toBe(false)
  })

  it('surfaces an internal fan-out bus on a composite input port from the outside', () => {
    const design = makeBusHolderDesign()
    const main = design.root
    expect(pinWidth(main, iref('bh', 'in:0'))).toBe(2)
    expect(isNeutralPin(main, iref('bh', 'in:0'))).toBe(false)
  })
})

function makeBusHolderDesign(): Design {
  const busHolder: CompositeDef = {
    id: 'bus-holder',
    name: 'bus-holder',
    kind: 'composite',
    ports: [
      { id: 'in:0', name: 'BUS', direction: 'input', terminal: { instanceId: 'bh-in', pinId: 'in:0' } },
      { id: 'out:0', name: 'BUS', direction: 'output', terminal: { instanceId: 'bh-out', pinId: 'out:0' } },
    ],
    instances: [
      pg('bh-in', 'input-port', 0, -40),
      pg('bh-out', 'output-port', 240, -40),
      gateDef('bh-fo', makeFanOut(2), 120, -40),
      gateDef('bh-fi', makeFanIn(2), 120, 40),
    ],
    connections: [
      { id: 'c-in', from: iref('bh-in', 'in:0'), to: iref('bh-fo', 'in:0') },
      { id: 'c-out', from: iref('bh-fi', 'out:0'), to: iref('bh-out', 'out:0') },
    ],
  }

  const main: CompositeDef = {
    id: 'main',
    name: 'main',
    kind: 'composite',
    ports: [],
    instances: [
      { id: 'bh', name: 'bh', def: busHolder, pos: { x: 0, y: 0 } },
      gate('g', 'and', 200, 0),
    ],
    connections: [],
  }

  return { version: 2, root: main, library: {} }
}

function makeFanIn(n: number): ChildDef {
  const ports: Port[] = []
  for (let i = 0; i < n; i++) ports.push({ id: `in:${i}`, name: `A${i}`, direction: 'input' })
  ports.push({ id: 'out:0', name: 'BUS', direction: 'output' })
  return { kind: 'fork', primitive: 'fan-in', ports }
}

function makeFanOut(n: number): ChildDef {
  const ports: Port[] = [{ id: 'in:0', name: 'BUS', direction: 'input' }]
  for (let i = 0; i < n; i++) ports.push({ id: `out:${i}`, name: `Y${i + 1}`, direction: 'output' })
  return { kind: 'fork', primitive: 'fan-out', ports }
}

function makeRelationDesign(n: number): Design {
  const main: CompositeDef = {
    id: 'main',
    name: 'main',
    kind: 'composite',
    ports: [],
    instances: [
      { id: 'fi', name: 'fi', def: makeFanIn(n), pos: { x: 0, y: 0 } },
      gate('bm', 'bus-merge', 100, 0),
      gate('bs', 'bus-split', 200, 0),
    ],
    connections: [
      { id: 'c1', from: iref('fi', 'out:0'), to: iref('bm', 'in:0') },
      { id: 'c2', from: iref('bm', 'out:0'), to: iref('bs', 'in:0') },
    ],
  }
  return { version: 2, root: main, library: {} }
}

describe('bus-split / bus-merge derived width', () => {
  it('propagates width through a merge→split chain', () => {
    const design = makeRelationDesign(6)
    const main = design.root
    expect(pinWidth(main, iref('fi', 'out:0'))).toBe(6)
    expect(pinWidth(main, iref('bm', 'in:0'))).toBe(6)
    expect(pinWidth(main, iref('bm', 'in:1'))).toBe(6)
    expect(pinWidth(main, iref('bm', 'out:0'))).toBe(12)
    expect(pinWidth(main, iref('bs', 'in:0'))).toBe(12)
    expect(pinWidth(main, iref('bs', 'out:0'))).toBe(6)
    expect(pinWidth(main, iref('bs', 'out:1'))).toBe(6)
    expect(isNeutralPin(main, iref('bs', 'out:0'))).toBe(false)
  })

  it('leaves an unwired merge→split chain undetermined (neutral)', () => {
    const design = makeRelationDesign(6)
    const main = design.root
    main.connections = [{ id: 'c2', from: iref('bm', 'out:0'), to: iref('bs', 'in:0') }]
    expect(isNeutralPin(main, iref('bm', 'out:0'))).toBe(true)
    expect(isNeutralPin(main, iref('bs', 'in:0'))).toBe(true)
    expect(pinWidth(main, iref('bm', 'out:0'))).toBe(1)
  })

  it('rejects an odd-width bus feeding a splitter input', () => {
    const main: CompositeDef = {
      id: 'main', name: 'main', kind: 'composite', ports: [],
      instances: [
        { id: 'fi', name: 'fi', def: makeFanIn(5), pos: { x: 0, y: 0 } },
        gate('bs', 'bus-split', 100, 0),
      ],
      connections: [],
    }
    expect(connectionError(main, iref('fi', 'out:0'), iref('bs', 'in:0'))).toBe('Bus width must be even')
  })

  it('accepts an even-width bus feeding a splitter input', () => {
    const main: CompositeDef = {
      id: 'main', name: 'main', kind: 'composite', ports: [],
      instances: [
        { id: 'fi', name: 'fi', def: makeFanIn(6), pos: { x: 0, y: 0 } },
        gate('bs', 'bus-split', 100, 0),
      ],
      connections: [],
    }
    expect(connectionError(main, iref('fi', 'out:0'), iref('bs', 'in:0'))).toBeNull()
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
    const main = design.root
    const bs = main.instances.find((i) => i.id === 'bs')!
    const def = bs.def

    const base = defBodySize(def)
    const eff = instanceBodySize(main, bs, def)
    expect(eff.h).toBeGreaterThan(base.h)

    const p0 = portPosition(main, bs, def, 'out:0')
    const p1 = portPosition(main, bs, def, 'out:1')
    const r = pinRadiusWorld(pinWidth(main, { instanceId: bs.id, portId: 'out:0' }))
    expect(Math.abs(p1.y - p0.y)).toBeGreaterThanOrEqual(2 * r)
    expect(p0.y - (bs.pos.y - eff.h / 2)).toBeGreaterThanOrEqual(r)
    expect((bs.pos.y + eff.h / 2) - p1.y).toBeGreaterThanOrEqual(r)
  })

  it('keeps the default size when all pins are single-wire', () => {
    const design = makeBusDesign()
    const main = design.root
    const fi = main.instances.find((i) => i.id === 'fi')!
    expect(instanceBodySize(main, fi, fi.def)).toEqual(defBodySize(fi.def))
  })
})
