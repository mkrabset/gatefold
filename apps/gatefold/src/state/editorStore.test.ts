import { describe, expect, it } from 'vitest'
import { builtinOf, forkOf, inputPortId, newUuid, outputPortId } from '@gatefold/model'
import type { CompositeDef, Design, Instance } from '@gatefold/model'
import {
  beginMoveTransaction,
  endMoveTransaction,
  useEditorStore,
} from './editorStore'

const mainDef = () => useEditorStore.getState().design.root
const mainInstances = (): Instance[] => mainDef().instances
const clkPos = () => mainInstances().find((i) => i.id === 'clk')!.pos

function reset() {
  useEditorStore.setState({
    design: makeTestDesign(),
    selectedIds: [],
    marquee: null,
    pendingWire: null,
    hoverPort: null,
    notice: null,
    navStack: [{ kind: 'root' }],
    pendingGroup: null,
    viewport: { x: 400, y: 250, zoom: 1 },
    viewportStack: [{ x: 400, y: 250, zoom: 1 }],
  })
  useEditorStore.temporal.getState().clear()
}

const gate = (id: string, kind: Parameters<typeof forkOf>[0], name: string, x: number, y: number): Instance => ({ id, name, def: forkOf(kind), pos: { x, y } })
const pg = (id: string, kind: 'input-port' | 'output-port', x: number, y: number): Instance => ({ id, name: '', def: builtinOf(kind), pos: { x, y } })

describe('editorStore undo/redo + clipboard', () => {
  it('undoes and redoes a delete', () => {
    reset()
    const before = mainInstances().length

    useEditorStore.getState().setSelection(['clk'])
    useEditorStore.getState().deleteSelection()
    expect(mainInstances().some((i) => i.id === 'clk')).toBe(false)

    useEditorStore.temporal.getState().undo()
    expect(mainInstances().some((i) => i.id === 'clk')).toBe(true)
    expect(mainInstances().length).toBe(before)

    useEditorStore.temporal.getState().redo()
    expect(mainInstances().some((i) => i.id === 'clk')).toBe(false)
  })

  it('coalesces a drag into a single undo step', () => {
    reset()
    expect(clkPos()).toEqual({ x: 100, y: 200 })

    beginMoveTransaction()
    useEditorStore.getState().setInstancesPosition(['clk'], [{ x: 110, y: 210 }])
    useEditorStore.getState().setInstancesPosition(['clk'], [{ x: 120, y: 220 }])
    useEditorStore.getState().setInstancesPosition(['clk'], [{ x: 130, y: 230 }])
    endMoveTransaction()
    expect(clkPos()).toEqual({ x: 130, y: 230 })

    useEditorStore.temporal.getState().undo()
    expect(clkPos()).toEqual({ x: 100, y: 200 })
  })

  it('supports a multi-step undo stack', () => {
    reset()
    beginMoveTransaction()
    useEditorStore.getState().setInstancesPosition(['clk'], [{ x: 300, y: 300 }])
    endMoveTransaction()
    useEditorStore.getState().setSelection(['inv1'])
    useEditorStore.getState().deleteSelection()
    expect(mainInstances().some((i) => i.id === 'inv1')).toBe(false)

    useEditorStore.temporal.getState().undo()
    expect(mainInstances().some((i) => i.id === 'inv1')).toBe(true)
    useEditorStore.temporal.getState().undo()
    expect(clkPos()).toEqual({ x: 100, y: 200 })
  })

  it('copies and pastes an independent instance', () => {
    reset()
    const before = mainInstances().length
    const inv1 = mainInstances().find((i) => i.id === 'inv1')!

    useEditorStore.getState().setSelection(['inv1'])
    useEditorStore.getState().copySelection()
    useEditorStore.getState().paste()
    expect(mainInstances().length).toBe(before + 1)
    const pasted = mainInstances()[mainInstances().length - 1]
    expect(pasted.def.kind === 'fork' && pasted.def.primitive).toBe('not')
    expect(pasted.def).not.toBe(inv1.def)

    useEditorStore.temporal.getState().undo()
    expect(mainInstances().length).toBe(before)
  })

  it('gives clock instances their default property values', () => {
    reset()
    const clk = mainInstances().find((i) => i.id === 'clk')!
    expect(clk.props).toEqual({ period: 10_000 })
  })

  it('populates defaults when placing a primitive', () => {
    reset()
    useEditorStore.getState().addInstance('clock', { x: 0, y: 0 })
    const placed = mainInstances()[mainInstances().length - 1]
    expect(placed.props).toEqual({ period: 10_000_000 })
  })

  it('places a join-point as a shared builtin', () => {
    reset()
    useEditorStore.getState().addInstance('join-point', { x: 0, y: 0 })
    const placed = mainInstances()[mainInstances().length - 1]
    expect(placed.def).toEqual({ kind: 'builtin', primitive: 'join-point' })
    expect(placed.props).toBeUndefined()
  })

  it('sets an instance property and undoes it', () => {
    reset()
    useEditorStore.getState().setInstanceProp('clk', 'period', 500)
    expect(mainInstances().find((i) => i.id === 'clk')!.props?.period).toBe(500)

    useEditorStore.temporal.getState().undo()
    expect(mainInstances().find((i) => i.id === 'clk')!.props?.period).toBe(10_000)
  })

  it('rejects connecting an odd-width bus to a splitter input', () => {
    reset()
    useEditorStore.setState({ design: makeSplitterDesign(), navStack: [{ kind: 'root' }], selectedIds: [] })
    useEditorStore.temporal.getState().clear()

    useEditorStore.getState().addConnection({ instanceId: 'fi', portId: 'out:0' }, { instanceId: 'bs', portId: 'in:0' })
    expect(useEditorStore.getState().notice).toBe('Bus width must be even')
    expect(mainDef().connections).toHaveLength(0)
  })

  it('rejects adding a second driver to an input (single-driver invariant)', () => {
    reset()
    useEditorStore.getState().addConnection({ instanceId: 'clk', portId: 'out:0' }, { instanceId: 'inv1', portId: 'in:0' })
    expect(useEditorStore.getState().notice).toBe('Input already has a driver')
  })

  it('rejects re-targeting a wire onto an already-driven input', () => {
    reset()
    useEditorStore.getState().retargetConnection('c1', { instanceId: 'and1', portId: 'in:0' })
    expect(useEditorStore.getState().notice).toBe('Input already has a driver')
  })

  it('renames a composite template but not the root or primitives', () => {
    reset()
    useEditorStore.getState().renameDef('half-adder', 'RippleAdder')
    expect(useEditorStore.getState().design.library['half-adder'].name).toBe('RippleAdder')

    useEditorStore.getState().renameDef('main', 'Nope')
    expect(useEditorStore.getState().design.root.name).toBe('main')

    useEditorStore.getState().renameDef('and', 'Nope')
    expect(useEditorStore.getState().design.library['and']).toBeUndefined()
  })

  it("rejects renaming a template to another template's name", () => {
    reset()
    useEditorStore.getState().renameDef('half-adder', 'or-gate')
    expect(useEditorStore.getState().notice).toBe('A component named "or-gate" already exists')
    expect(useEditorStore.getState().design.library['half-adder'].name).toBe('half-adder')
  })

  it('ignores built-in and non-template names when renaming a template', () => {
    reset()
    useEditorStore.getState().renameDef('half-adder', 'AND')
    expect(useEditorStore.getState().design.library['half-adder'].name).toBe('AND')
    expect(useEditorStore.getState().notice).toBeNull()
  })

  it('deletes a template together with its embedded parts', () => {
    reset()
    useEditorStore.setState({ design: makeEmbeddedDesign(), navStack: [{ kind: 'root' }], selectedIds: [] })
    useEditorStore.temporal.getState().clear()

    const state = useEditorStore.getState()
    state.requestDeleteTemplate('ander2')
    state.confirmDeleteTemplate()

    const lib = useEditorStore.getState().design.library
    expect(lib['ander2']).toBeUndefined()
    // The origin template the copies came from is untouched.
    expect(lib['ander']).toBeDefined()
    // The live copy on the canvas survives, untethered (uuid cleared).
    const live = useEditorStore.getState().design.root.instances.find((i) => i.id === 'x')!.def as CompositeDef
    expect(live.id).toBe('ander2~live')
    expect(live.uuid).toBeUndefined()
  })

  it('sets, renames, and clears a template category', () => {
    reset()
    const def = () => useEditorStore.getState().design.library['half-adder']

    useEditorStore.getState().setDefCategory('half-adder', '  Arithmetic  ')
    expect(def().category).toBe('Arithmetic')

    useEditorStore.getState().setDefCategory('half-adder', 'Logic')
    expect(def().category).toBe('Logic')

    useEditorStore.getState().setDefCategory('half-adder', '   ')
    expect(def().category).toBeUndefined()

    useEditorStore.temporal.getState().undo()
    expect(def().category).toBe('Logic')
  })

  it('ignores setDefCategory on non-templates', () => {
    reset()
    useEditorStore.getState().setDefCategory('main', 'Nope')
    expect(useEditorStore.getState().design.root.category).toBeUndefined()

    useEditorStore.getState().setDefCategory('and', 'Nope')
    expect(useEditorStore.getState().design.library['and']).toBeUndefined()
  })

  it('promotes a single component to a new template, leaving the instance a live copy', () => {
    reset()
    const state = useEditorStore.getState()
    state.setSelection(['ha1'])
    state.openGroupDialog()
    state.setGroupName('MyAdder')
    state.confirmGroup()

    const s = useEditorStore.getState()
    const template = Object.values(s.design.library).find((d) => d.name === 'MyAdder')
    expect(template).toBeDefined()

    // The clicked instance still owns its own live copy.
    const ha1 = mainInstances().find((i) => i.id === 'ha1')!
    const instanceDef = ha1.def as CompositeDef
    expect(instanceDef.name).toBe('half-adder')

    // The promoted template's internals are deep-copied (not shared with the instance).
    const templateXor = template!.instances.find((i) => i.id === 'ha-xor')!
    const instanceXor = instanceDef.instances.find((i) => i.id === 'ha-xor')!
    expect(templateXor.def).not.toBe(instanceXor.def)
  })

  it('grouping deep-copies nested components so the instance is independent of the template', () => {
    reset()
    const state = useEditorStore.getState()
    state.setSelection(['ha1', 'and1'])
    state.openGroupDialog()
    state.setGroupName('combo')
    state.confirmGroup()

    const s = useEditorStore.getState()
    const template = Object.values(s.design.library).find((d) => d.name === 'combo')!
    const newInst = mainInstances()[mainInstances().length - 1]
    const variant = newInst.def as CompositeDef
    expect(variant).toBeDefined()

    const templateHa = template.instances.find((i) => i.id === 'ha1')!
    const variantHa = variant.instances.find((i) => i.id === 'ha1')!
    expect(variantHa.def).not.toBe(templateHa.def)
  })

  it('places the port groups outside the grouped components (template and copy)', () => {
    reset()
    const state = useEditorStore.getState()
    state.setSelection(['clk', 'or1'])
    state.openGroupDialog()
    state.setGroupName('wide')
    state.confirmGroup()

    const s = useEditorStore.getState()
    const template = Object.values(s.design.library).find((d) => d.name === 'wide')!
    const newInst = mainInstances()[mainInstances().length - 1]
    const variant = newInst.def as CompositeDef

    for (const def of [template, variant]) {
      const inputGroup = def.instances.find((i) => i.def.kind === 'builtin' && i.def.primitive === 'input-port')
      const outputGroup = def.instances.find((i) => i.def.kind === 'builtin' && i.def.primitive === 'output-port')
      expect(inputGroup).toBeDefined()
      expect(outputGroup).toBeDefined()
      expect(inputGroup!.pos.x).toBeLessThan(100)
      expect(outputGroup!.pos.x).toBeGreaterThan(730)
    }
  })

  it('preserves port-group positions when grouping includes the port groups', () => {
    reset()
    useEditorStore.setState({ design: makePortGroupDesign(), navStack: [{ kind: 'root' }], selectedIds: ['a', 'in', 'out'] })
    useEditorStore.temporal.getState().clear()

    const state = useEditorStore.getState()
    state.openGroupDialog()
    state.setGroupName('sub')
    state.confirmGroup()

    const s = useEditorStore.getState()
    const template = Object.values(s.design.library).find((d) => d.name === 'sub')!
    const newInst = mainDef().instances.find((i) => i.def.kind === 'composite' && i.def.name === 'sub')!
    const variant = newInst.def as CompositeDef

    for (const def of [template, variant]) {
      const inGroup = def.instances.find((i) => i.def.kind === 'builtin' && i.def.primitive === 'input-port')!
      const outGroup = def.instances.find((i) => i.def.kind === 'builtin' && i.def.primitive === 'output-port')!
      expect(inGroup.pos).toEqual({ x: 0, y: 0 })
      expect(outGroup.pos).toEqual({ x: 200, y: 0 })
    }
  })

  it('keeps template ports clean and allows inverting a live copy', () => {
    reset()
    // A template's terminals cannot be inverted (the scope-editor path never targets them).
    useEditorStore.setState({ navStack: [{ kind: 'template', id: 'half-adder' }] })
    const tPort = () => useEditorStore.getState().design.library['half-adder'].ports.find((p) => p.id === 'in:0')!
    useEditorStore.getState().setPortInverted('in:0', true)
    expect(tPort().inverted).toBeUndefined()

    // An instance-local copy can be inverted from outside (via its instance id).
    useEditorStore.setState({ navStack: [{ kind: 'root' }] })
    const vPort = () => (mainInstances().find((i) => i.id === 'ha1')!.def as CompositeDef).ports.find((p) => p.id === 'in:0')!
    useEditorStore.getState().setPortInverted('in:0', true, 'ha1')
    expect(vPort().inverted).toBe(true)
    useEditorStore.getState().setPortInverted('in:0', false, 'ha1')
    expect(vPort().inverted).toBeUndefined()
  })

  it("does not invert the scope's own ports (the input/output port groups)", () => {
    reset()
    useEditorStore.setState({ design: makePortGroupDesign(), navStack: [{ kind: 'root' }], selectedIds: [] })
    useEditorStore.temporal.getState().clear()

    useEditorStore.getState().setPortInverted('in:0', true)
    expect(useEditorStore.getState().design.root.ports.find((p) => p.id === 'in:0')!.inverted).toBeUndefined()
  })

  it('does not invert a port-group pin', () => {
    reset()
    useEditorStore.setState({ design: makePortGroupDesign(), navStack: [{ kind: 'root' }], selectedIds: [] })
    useEditorStore.temporal.getState().clear()

    useEditorStore.getState().togglePinInversion({ instanceId: 'in', portId: 'in:0' })
    expect(useEditorStore.getState().design.root.ports.find((p) => p.id === 'in:0')!.inverted).toBeUndefined()
  })

  it('toggles pin inversion on the hovered pin', () => {
    reset()
    const port = () => (mainInstances().find((i) => i.id === 'ha1')!.def as CompositeDef).ports.find((p) => p.id === 'in:0')!

    useEditorStore.getState().togglePinInversion({ instanceId: 'ha1', portId: 'in:0' })
    expect(port().inverted).toBe(true)

    useEditorStore.getState().togglePinInversion({ instanceId: 'ha1', portId: 'in:0' })
    expect(port().inverted).toBeUndefined()
  })

  it('splits a wire and inserts a join-point', () => {
    reset()
    useEditorStore.getState().insertJoinPointAt('c1', { x: 200, y: 150 })

    const s = useEditorStore.getState()
    const main = mainDef()
    const conns = main.connections

    expect(conns.some((c) => c.id === 'c1')).toBe(false)

    const jp = main.instances.find((i) => i.def.kind === 'builtin' && i.def.primitive === 'join-point')
    expect(jp).toBeDefined()
    expect(s.selectedIds).toEqual([jp!.id])

    const inConn = conns.find((c) => c.to.instanceId === jp!.id && c.to.portId === 'in:0')
    const outConn = conns.find((c) => c.from.instanceId === jp!.id && c.from.portId === 'out:0')
    expect(inConn).toBeDefined()
    expect(outConn).toBeDefined()
    expect(inConn!.from).toEqual({ instanceId: 'clk', portId: 'out:0' })
    expect(outConn!.to).toEqual({ instanceId: 'inv1', portId: 'in:0' })

    useEditorStore.temporal.getState().undo()
    const restored = mainDef()
    expect(restored.connections.some((c) => c.id === 'c1')).toBe(true)
    expect(restored.instances.some((i) => i.id === jp!.id)).toBe(false)
  })
})

// A design with a 5-input fan-in and an unconnected bus-split.
function makeSplitterDesign(): Design {
  const ports: { id: string; name: string; direction: 'input' | 'output' }[] = []
  for (let i = 0; i < 5; i++) ports.push({ id: `in:${i}`, name: `A${i}`, direction: 'input' })
  ports.push({ id: 'out:0', name: 'BUS', direction: 'output' })
  const main: CompositeDef = {
    id: 'main',
    name: 'main',
    kind: 'composite',
    ports: [],
    instances: [
      { id: 'fi', name: 'fi', def: { kind: 'fork', primitive: 'fan-in', ports }, pos: { x: 0, y: 0 } },
      gate('bs', 'bus-split', 'bs', 100, 0),
    ],
    connections: [],
  }
  return { version: 2, root: main, library: {} }
}

function halfAdder(id: string, uuid: string): CompositeDef {
  return {
    id,
    name: 'half-adder',
    kind: 'composite',
    uuid,
    ports: [
      { id: inputPortId(0), name: 'A', direction: 'input', terminal: { instanceId: 'ha-in', pinId: 'in:0' } },
      { id: inputPortId(1), name: 'B', direction: 'input', terminal: { instanceId: 'ha-in', pinId: 'in:1' } },
      { id: outputPortId(0), name: 'S', direction: 'output', terminal: { instanceId: 'ha-out', pinId: 'out:0' } },
      { id: outputPortId(1), name: 'C', direction: 'output', terminal: { instanceId: 'ha-out', pinId: 'out:1' } },
    ],
    instances: [
      pg('ha-in', 'input-port', 60, 250),
      gate('ha-xor', 'xor', 'xor1', 140, 180),
      gate('ha-and', 'and', 'and1', 140, 320),
      pg('ha-out', 'output-port', 220, 250),
    ],
    connections: [],
  }
}

// A sample design with the built-in primitives, a half-adder, and a small demo circuit.
function makeTestDesign(): Design {
  const uuidHa = newUuid()
  const library: Record<string, CompositeDef> = {
    'half-adder': halfAdder('half-adder', uuidHa),
    'or-gate': { id: 'or-gate', name: 'or-gate', kind: 'composite', uuid: newUuid(), ports: [], instances: [], connections: [] },
  }

  const main: CompositeDef = {
    id: 'main',
    name: 'main',
    kind: 'composite',
    uuid: newUuid(),
    ports: [],
    instances: [
      { id: 'clk', name: 'clk', def: forkOf('clock'), pos: { x: 100, y: 200 }, props: { period: 10_000 } },
      gate('inv1', 'not', 'inv1', 300, 100),
      gate('and1', 'and', 'and1', 300, 330),
      gate('xor1', 'xor', 'xor1', 500, 150),
      { id: 'ha1', name: 'ha1', def: halfAdder('ha1-copy', uuidHa), pos: { x: 500, y: 360 } },
      gate('or1', 'or', 'or1', 730, 250),
    ],
    connections: [
      { id: 'c1', from: { instanceId: 'clk', portId: 'out:0' }, to: { instanceId: 'inv1', portId: 'in:0' } },
      { id: 'c2', from: { instanceId: 'clk', portId: 'out:0' }, to: { instanceId: 'and1', portId: 'in:0' } },
      { id: 'c3', from: { instanceId: 'inv1', portId: 'out:0' }, to: { instanceId: 'and1', portId: 'in:1' } },
      { id: 'c4', from: { instanceId: 'clk', portId: 'out:0' }, to: { instanceId: 'xor1', portId: 'in:0' } },
      { id: 'c5', from: { instanceId: 'inv1', portId: 'out:0' }, to: { instanceId: 'xor1', portId: 'in:1' } },
      { id: 'c6', from: { instanceId: 'and1', portId: 'out:0' }, to: { instanceId: 'or1', portId: 'in:0' } },
      { id: 'c7', from: { instanceId: 'xor1', portId: 'out:0' }, to: { instanceId: 'or1', portId: 'in:1' } },
      { id: 'c8', from: { instanceId: 'clk', portId: 'out:0' }, to: { instanceId: 'ha1', portId: 'in:0' } },
      { id: 'c9', from: { instanceId: 'inv1', portId: 'out:0' }, to: { instanceId: 'ha1', portId: 'in:1' } },
    ],
  }

  return { version: 2, root: main, library }
}

// A root with its own input/output port groups (at x=0 and x=200) wired through an AND.
function makePortGroupDesign(): Design {
  const main: CompositeDef = {
    id: 'main',
    name: 'main',
    kind: 'composite',
    uuid: newUuid(),
    ports: [
      { id: inputPortId(0), name: 'A', direction: 'input', terminal: { instanceId: 'in', pinId: 'in:0' } },
      { id: inputPortId(1), name: 'B', direction: 'input', terminal: { instanceId: 'in', pinId: 'in:1' } },
      { id: outputPortId(0), name: 'Y', direction: 'output', terminal: { instanceId: 'out', pinId: 'out:0' } },
    ],
    instances: [
      pg('in', 'input-port', 0, 0),
      gate('a', 'and', 'a', 100, 0),
      pg('out', 'output-port', 200, 0),
    ],
    connections: [
      { id: 'c1', from: { instanceId: 'in', portId: 'in:0' }, to: { instanceId: 'a', portId: 'in:0' } },
      { id: 'c2', from: { instanceId: 'in', portId: 'in:1' }, to: { instanceId: 'a', portId: 'in:1' } },
      { id: 'c3', from: { instanceId: 'a', portId: 'out:0' }, to: { instanceId: 'out', portId: 'out:0' } },
    ],
  }
  return { version: 2, root: main, library: {} }
}

// A template "ander2" embedding two copies of "ander", plus a live copy on the canvas.
function makeEmbeddedDesign(): Design {
  const copy = (id: string): CompositeDef => ({
    id,
    name: 'ander',
    kind: 'composite',
    uuid: 'u-ander',
    ports: [],
    instances: [gate('g1', 'and', '', 0, 0)],
    connections: [],
  })
  const ander: CompositeDef = copy('ander')
  const ander2: CompositeDef = {
    id: 'ander2',
    name: 'ander2',
    kind: 'composite',
    uuid: 'u-ander2',
    ports: [],
    instances: [
      { id: 'c1', name: '', def: copy('ander~a'), pos: { x: 0, y: 0 } },
      { id: 'c2', name: '', def: copy('ander~b'), pos: { x: 100, y: 0 } },
    ],
    connections: [],
  }
  const live: CompositeDef = {
    id: 'ander2~live',
    name: 'ander2',
    kind: 'composite',
    uuid: 'u-ander2',
    ports: [],
    instances: [
      { id: 'c1', name: '', def: copy('ander~c'), pos: { x: 0, y: 0 } },
      { id: 'c2', name: '', def: copy('ander~d'), pos: { x: 100, y: 0 } },
    ],
    connections: [],
  }
  const main: CompositeDef = {
    id: 'main',
    name: 'main',
    kind: 'composite',
    uuid: newUuid(),
    ports: [],
    instances: [{ id: 'x', name: '', def: live, pos: { x: 0, y: 0 } }],
    connections: [],
  }
  return { version: 2, root: main, library: { ander, ander2 } }
}
