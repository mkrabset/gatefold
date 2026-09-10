import { afterEach, describe, expect, it } from 'vitest'
import type { ChildDef, CompositeDef, Design, Port } from '@gatefold/model'
import { builtinOf, connectionError, forkOf } from '@gatefold/model'
import { COMPACT_VALUE_CHAR_W, COMPACT_VALUE_PAD, DEFAULT_LANE_DISTANCE, MIN_PIN_RADIUS, busWireOffsets, currentLaneDistance, defBodySize, instanceBodySize, isNeutralPin, laneDistanceFor, pinRadiusWorld, pinRadiusWorldAt, pinWidth, portPosition, setLaneDistance, sideHeight, sidePinOffset } from './geometry'

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

describe('lane distance', () => {
  afterEach(() => setLaneDistance(DEFAULT_LANE_DISTANCE))

  it('scales the pin marker radius linearly with the setting', () => {
    expect(pinRadiusWorld(4)).toBe(14)
    setLaneDistance(3)
    expect(currentLaneDistance()).toBe(3)
    expect(pinRadiusWorld(4)).toBe(6)
  })

  it('clamps the setting to 0..DEFAULT_LANE_DISTANCE', () => {
    setLaneDistance(100)
    expect(currentLaneDistance()).toBe(DEFAULT_LANE_DISTANCE)
    setLaneDistance(-5)
    expect(currentLaneDistance()).toBe(0)
  })

  it('never thins a terminal below MIN_PIN_RADIUS', () => {
    for (const width of [1, 2, 8, 32]) {
      expect(pinRadiusWorldAt(width, 0)).toBe(MIN_PIN_RADIUS)
      expect(pinRadiusWorldAt(width, DEFAULT_LANE_DISTANCE)).toBe((DEFAULT_LANE_DISTANCE / 2) * width)
    }
  })

  it('keeps adjacent terminal labels apart at low lane distance', () => {
    // Two adjacent markers: their center spacing must stay >= the label height.
    const gap = (d: number) => sidePinOffset([1, 1], 1, d) - sidePinOffset([1, 1], 0, d)
    const atDefault = gap(DEFAULT_LANE_DISTANCE)
    expect(gap(0)).toBe(atDefault)
    expect(gap(1)).toBeGreaterThanOrEqual(2 * MIN_PIN_RADIUS + 4)
  })

  it('shrinks bus lane spacing when the distance is reduced', () => {
    const atDefault = busWireOffsets(4)
    expect(atDefault).toHaveLength(4)
    setLaneDistance(2)
    const atTwo = busWireOffsets(4)
    expect(atTwo).toHaveLength(4)
    expect(Math.abs(atTwo[1] - atTwo[0])).toBeLessThan(Math.abs(atDefault[1] - atDefault[0]))
  })

  it('accepts an explicit distance that bypasses the global setting', () => {
    const baseline = busWireOffsets(4)
    setLaneDistance(1)
    expect(busWireOffsets(4)).not.toEqual(baseline)
    expect(busWireOffsets(4, DEFAULT_LANE_DISTANCE)).toEqual(baseline)
  })

  it('passes the distance through the side-sizing helpers', () => {
    expect(sideHeight([2], DEFAULT_LANE_DISTANCE)).toBeGreaterThan(sideHeight([2], 2))
    expect(sidePinOffset([2, 2], 1, DEFAULT_LANE_DISTANCE)).toBeGreaterThan(sidePinOffset([2, 2], 1, 2))
  })

  it('keeps array terminals at the default distance', () => {
    const sw = forkOf('switch-array')
    const led = forkOf('led-array')
    const and = forkOf('and')
    expect(laneDistanceFor(sw)).toBe(DEFAULT_LANE_DISTANCE)
    expect(laneDistanceFor(led)).toBe(DEFAULT_LANE_DISTANCE)
    setLaneDistance(2)
    expect(laneDistanceFor(sw)).toBe(DEFAULT_LANE_DISTANCE)
    expect(laneDistanceFor(led)).toBe(DEFAULT_LANE_DISTANCE)
    expect(laneDistanceFor(and)).toBe(2)
  })

  it('exempts an led-array bus terminal from the lane-distance setting', () => {
    const design = makeArrayDesign(8)
    const main = design.root
    const led = main.instances.find((i) => i.id === 'led')!
    expect(pinWidth(main, iref('led', 'in:0'))).toBe(8)
    const atDefault = instanceBodySize(main, led, led.def)
    expect(atDefault.h).toBeGreaterThan(defBodySize(led.def).h)
    setLaneDistance(2)
    expect(instanceBodySize(main, led, led.def).h).toBe(atDefault.h)
  })
})

function makeArrayDesign(n: number): Design {
  const main: CompositeDef = {
    id: 'main',
    name: 'main',
    kind: 'composite',
    ports: [],
    instances: [
      { id: 'fi', name: 'fi', def: makeFanIn(n), pos: { x: 0, y: 0 } },
      { id: 'led', name: 'led', def: forkOf('led-array'), pos: { x: 120, y: 0 } },
    ],
    connections: [{ id: 'w', from: iref('fi', 'out:0'), to: iref('led', 'in:0') }],
  }
  return { version: 2, root: main, library: {} }
}

function makeSwitchDesign(n: number, compact: boolean): Design {
  const main: CompositeDef = {
    id: 'main',
    name: 'main',
    kind: 'composite',
    ports: [],
    instances: [
      { id: 'sw', name: 'sw', def: forkOf('switch-array'), pos: { x: 0, y: 0 }, props: { compact } },
      { id: 'fo', name: 'fo', def: makeFanOut(n), pos: { x: 120, y: 0 } },
    ],
    connections: [{ id: 'w', from: iref('sw', 'out:0'), to: iref('fo', 'in:0') }],
  }
  return { version: 2, root: main, library: {} }
}

describe('compact switch array body', () => {
  afterEach(() => setLaneDistance(DEFAULT_LANE_DISTANCE))

  it('follows the active lane distance instead of the array default', () => {
    const compact = makeSwitchDesign(8, true)
    const plain = makeSwitchDesign(8, false)
    setLaneDistance(2)
    // Compact switch follows d=2: side height 12 + 2·8 = 28 → body capped at base 40.
    expect(instanceBodySize(compact.root, compact.root.instances.find((i) => i.id === 'sw')!, compact.root.instances.find((i) => i.id === 'sw')!.def).h).toBe(40)
    // Non-compact array keeps the default distance (12 + 2·28 = 68).
    expect(instanceBodySize(plain.root, plain.root.instances.find((i) => i.id === 'sw')!, plain.root.instances.find((i) => i.id === 'sw')!.def).h).toBe(68)
  })

  it('is at least as tall as its terminal marker side', () => {
    const design = makeSwitchDesign(8, true)
    const main = design.root
    const sw = main.instances.find((i) => i.id === 'sw')!
    expect(pinWidth(main, iref('sw', 'out:0'))).toBe(8)
    // At the default distance the body matches the terminal side height (68).
    expect(instanceBodySize(main, sw, sw.def).h).toBe(68)
  })

  it('widens to fit the maximum value in the instance radix', () => {
    const design = makeSwitchDesign(32, true)
    const main = design.root
    const sw = main.instances.find((i) => i.id === 'sw')!
    // 32-bit HEX = 8 chars → wider than the base 56 box.
    expect(instanceBodySize(main, sw, sw.def).w).toBe(2 * COMPACT_VALUE_PAD + 8 * COMPACT_VALUE_CHAR_W)
  })

  it('inflates the body with the bus width when not compact', () => {
    const design = makeSwitchDesign(8, false)
    const main = design.root
    const sw = main.instances.find((i) => i.id === 'sw')!
    expect(instanceBodySize(main, sw, sw.def).h).toBeGreaterThan(defBodySize(sw.def).h)
  })
})
