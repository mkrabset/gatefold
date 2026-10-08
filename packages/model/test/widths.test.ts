import { describe, expect, it } from 'vitest'
import type { CompositeDef, Design, Instance } from '../src/types'
import { builtinOf, connectionError, counterPorts, forkOf, isNeutralPin, pinWidth } from '../src/index'

const iref = (instanceId: string, portId: string) => ({ instanceId, portId })

const inst = (id: string, def: Instance['def'], x = 0, y = 0, props?: Instance['props']): Instance => ({
  id,
  name: id,
  def,
  pos: { x, y },
  ...(props ? { props } : {}),
})

/**
 * The user's "compareWithOne" component: a bus input feeding one side of a COMPARE, and
 * an internal switch-array (constant) feeding the other. Every internal bus is neutral —
 * the whole component's width is determined entirely by the external connection.
 */
function makeCompareWithOneDesign(): Design {
  const compareWithOne: CompositeDef = {
    id: 'compareWithOne',
    name: 'compareWithOne',
    kind: 'composite',
    ports: [{ id: 'in:0', name: 'BUS', direction: 'input', terminal: { instanceId: 'cwo-in', pinId: 'in:0' } }],
    instances: [
      inst('cwo-in', builtinOf('input-port')),
      inst('cmp', forkOf('compare')),
      inst('sw', forkOf('switch-array')),
    ],
    connections: [
      { id: 'c1', from: iref('cwo-in', 'in:0'), to: iref('cmp', 'in:0') },
      { id: 'c2', from: iref('sw', 'out:0'), to: iref('cmp', 'in:1') },
    ],
  }

  const main: CompositeDef = {
    id: 'main',
    name: 'main',
    kind: 'composite',
    ports: [],
    instances: [
      inst('bus4', forkOf('bus'), 0, 0, { lanes: 4 }),
      { id: 'cwo', name: 'cwo', def: compareWithOne, pos: { x: 120, y: 0 } },
    ],
    connections: [{ id: 'w', from: iref('bus4', 'out:0'), to: iref('cwo', 'in:0') }],
  }

  return { version: 2, root: main, library: {} }
}

describe('global width resolution across composite boundaries', () => {
  it('resolves every neutral internal bus of a nested component from the external connection', () => {
    const design = makeCompareWithOneDesign()
    const root = design.root
    const cwo = root.instances.find((i) => i.id === 'cwo')!.def as CompositeDef

    // The composite's boundary pin (seen from the parent) adopts the external width.
    expect(pinWidth(root, root, iref('cwo', 'in:0'))).toBe(4)
    expect(isNeutralPin(root, root, iref('cwo', 'in:0'))).toBe(false)

    // And the external width propagates inward to every neutral internal pin.
    expect(pinWidth(root, cwo, iref('cwo-in', 'in:0'))).toBe(4)
    expect(pinWidth(root, cwo, iref('cmp', 'in:0'))).toBe(4)
    expect(pinWidth(root, cwo, iref('cmp', 'in:1'))).toBe(4)
    expect(pinWidth(root, cwo, iref('sw', 'out:0'))).toBe(4)
    expect(isNeutralPin(root, cwo, iref('cmp', 'in:0'))).toBe(false)

    // The COMPARE output is always a single wire.
    expect(pinWidth(root, cwo, iref('cmp', 'out:0'))).toBe(1)
  })

  it('keeps a component neutral when no external width reaches it', () => {
    const design = makeCompareWithOneDesign()
    const root = design.root
    const cwo = root.instances.find((i) => i.id === 'cwo')!.def as CompositeDef
    // Unwire the external bus: everything stays undetermined.
    root.connections = []
    expect(isNeutralPin(root, root, iref('cwo', 'in:0'))).toBe(true)
    expect(isNeutralPin(root, cwo, iref('cmp', 'in:0'))).toBe(true)
    expect(pinWidth(root, cwo, iref('cmp', 'out:0'))).toBe(1)
  })

  it('resolves an uneven bus-split (firstLanes) from the connection', () => {
    const main: CompositeDef = {
      id: 'main',
      name: 'main',
      kind: 'composite',
      ports: [],
      instances: [
        inst('bus64', forkOf('bus'), 0, 0, { lanes: 64 }),
        inst('bs', forkOf('bus-split'), 0, 0, { firstLanes: 10 }),
      ],
      connections: [{ id: 'w', from: iref('bus64', 'out:0'), to: iref('bs', 'in:0') }],
    }
    const design: Design = { version: 2, root: main, library: {} }
    const root = design.root
    expect(pinWidth(root, root, iref('bs', 'in:0'))).toBe(64)
    expect(pinWidth(root, root, iref('bs', 'out:0'))).toBe(10)
    expect(pinWidth(root, root, iref('bs', 'out:1'))).toBe(54)
    expect(isNeutralPin(root, root, iref('bs', 'out:0'))).toBe(false)
    expect(isNeutralPin(root, root, iref('bs', 'out:1'))).toBe(false)
  })
})

describe('register/counter bus width pinned by the width property', () => {
  const mainWith = (instances: Instance[], connections: CompositeDef['connections']): CompositeDef => ({
    id: 'main',
    name: 'main',
    kind: 'composite',
    ports: [],
    instances,
    connections,
  })

  /** A counter fork with BUS-mode ports (a single neutral `Q`). */
  const busCounter = (): Instance['def'] => {
    const f = forkOf('counter')
    f.ports = counterPorts('bus', 0)
    return f
  }

  it('pins a counter Q bus to the width property, and stays neutral at width 0', () => {
    const root = mainWith([inst('cnt', busCounter(), 0, 0, { width: 5 })], [])
    expect(pinWidth(root, root, iref('cnt', 'out:0'))).toBe(5)
    expect(isNeutralPin(root, root, iref('cnt', 'out:0'))).toBe(false)

    const neutral = mainWith([inst('cnt', busCounter(), 0, 0, { width: 0 })], [])
    expect(isNeutralPin(neutral, neutral, iref('cnt', 'out:0'))).toBe(true)
  })

  it('pins a register DATA and Q buses to the width property', () => {
    const root = mainWith([inst('reg', forkOf('register'), 0, 0, { width: 6 })], [])
    expect(pinWidth(root, root, iref('reg', 'in:2'))).toBe(6)
    expect(pinWidth(root, root, iref('reg', 'out:0'))).toBe(6)
    expect(isNeutralPin(root, root, iref('reg', 'in:2'))).toBe(false)
    expect(isNeutralPin(root, root, iref('reg', 'out:0'))).toBe(false)
  })

  it('still couples a register DATA and Q bus from the connection when width is 0', () => {
    const root = mainWith(
      [inst('bus8', forkOf('bus'), 0, 0, { lanes: 8 }), inst('reg', forkOf('register'), 0, 0, { width: 0 })],
      [{ id: 'w', from: iref('bus8', 'out:0'), to: iref('reg', 'in:2') }],
    )
    expect(pinWidth(root, root, iref('reg', 'in:2'))).toBe(8)
    expect(pinWidth(root, root, iref('reg', 'out:0'))).toBe(8)
  })

  it('rejects a mismatched connection to a pinned counter Q bus', () => {
    const root = mainWith(
      [inst('cnt', busCounter(), 0, 0, { width: 5 }), inst('bus4', forkOf('bus'), 0, 0, { lanes: 4 })],
      [],
    )
    expect(connectionError(root, root, iref('cnt', 'out:0'), iref('bus4', 'in:0'))).toBe('Bus width mismatch')
  })

  it('rejects a mismatched connection to a pinned register DATA bus', () => {
    const root = mainWith(
      [inst('bus4', forkOf('bus'), 0, 0, { lanes: 4 }), inst('reg', forkOf('register'), 0, 0, { width: 6 })],
      [],
    )
    expect(connectionError(root, root, iref('bus4', 'out:0'), iref('reg', 'in:2'))).toBe('Bus width mismatch')
  })
})
