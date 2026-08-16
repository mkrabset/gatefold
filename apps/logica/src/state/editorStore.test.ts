import { describe, expect, it } from 'vitest'
import { primitiveDef } from '@logica/model'
import type { ComponentDef, Design } from '@logica/model'
import {
  beginMoveTransaction,
  createDemoDesign,
  endMoveTransaction,
  useEditorStore,
} from './editorStore'

const mainInstances = () => useEditorStore.getState().design.defs['main'].instances ?? []
const clkPos = () => mainInstances().find((i) => i.id === 'clk')!.pos

function reset() {
  useEditorStore.setState({
    design: createDemoDesign(),
    selectedIds: [],
    marquee: null,
    pendingWire: null,
    hoverPort: null,
    notice: null,
    navStack: ['main'],
    pendingGroup: null,
    viewport: { x: 400, y: 250, zoom: 1 },
  })
  useEditorStore.temporal.getState().clear()
}

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

    // A single undo restores the pre-drag position.
    useEditorStore.temporal.getState().undo()
    expect(clkPos()).toEqual({ x: 100, y: 200 })
  })

  it('supports a multi-step undo stack', () => {
    reset()
    // Edit 1: move clk.
    beginMoveTransaction()
    useEditorStore.getState().setInstancesPosition(['clk'], [{ x: 300, y: 300 }])
    endMoveTransaction()
    // Edit 2: delete inv1.
    useEditorStore.getState().setSelection(['inv1'])
    useEditorStore.getState().deleteSelection()
    expect(mainInstances().some((i) => i.id === 'inv1')).toBe(false)

    // Undo edit 2 -> inv1 restored.
    useEditorStore.temporal.getState().undo()
    expect(mainInstances().some((i) => i.id === 'inv1')).toBe(true)
    // Undo edit 1 -> clk back at origin.
    useEditorStore.temporal.getState().undo()
    expect(clkPos()).toEqual({ x: 100, y: 200 })
  })

  it('copies and pastes an independent instance', () => {
    reset()
    const before = mainInstances().length

    useEditorStore.getState().setSelection(['inv1'])
    useEditorStore.getState().copySelection()
    useEditorStore.getState().paste()
    expect(mainInstances().length).toBe(before + 1)
    const pasted = mainInstances()[mainInstances().length - 1]
    expect(pasted.defId).not.toBe('not')

    useEditorStore.temporal.getState().undo()
    expect(mainInstances().length).toBe(before)
  })

  it('gives clock instances their default property values', () => {
    reset()
    const clk = mainInstances().find((i) => i.id === 'clk')!
    expect(clk.props).toEqual({ period: 1000 })
  })

  it('populates defaults when placing a primitive', () => {
    reset()
    useEditorStore.getState().addInstance('clock', { x: 0, y: 0 })
    const placed = mainInstances()[mainInstances().length - 1]
    expect(placed.props).toEqual({ period: 1000 })
  })

  it('sets an instance property and undoes it', () => {
    reset()
    useEditorStore.getState().setInstanceProp('clk', 'period', 500)
    expect(mainInstances().find((i) => i.id === 'clk')!.props?.period).toBe(500)

    useEditorStore.temporal.getState().undo()
    expect(mainInstances().find((i) => i.id === 'clk')!.props?.period).toBe(1000)
  })

  it('rejects connecting an odd-width bus to a splitter input', () => {
    reset()
    useEditorStore.setState({ design: makeSplitterDesign(), navStack: ['main'], selectedIds: [] })
    useEditorStore.temporal.getState().clear()

    useEditorStore.getState().addConnection({ instanceId: 'fi', portId: 'out:0' }, { instanceId: 'bs', portId: 'in:0' })
    expect(useEditorStore.getState().notice).toBe('Bus width must be even')
    expect(useEditorStore.getState().design.defs['main'].connections).toHaveLength(0)
  })

  it('renames a composite template but not the root or primitives', () => {
    reset()
    useEditorStore.getState().renameDef('half-adder', 'RippleAdder')
    expect(useEditorStore.getState().design.defs['half-adder'].name).toBe('RippleAdder')

    useEditorStore.getState().renameDef('main', 'Nope')
    expect(useEditorStore.getState().design.defs['main'].name).toBe('main')

    useEditorStore.getState().renameDef('and', 'Nope')
    expect(useEditorStore.getState().design.defs['and'].name).toBe('AND')
  })

  it('promotes a single component to a new template, leaving the instance a variant', () => {
    reset()
    const state = useEditorStore.getState()
    state.setSelection(['ha1'])
    state.openGroupDialog()
    state.setGroupName('MyAdder')
    state.confirmGroup()

    const s = useEditorStore.getState()
    // A new template exists with the dialog name (variant unset).
    const template = Object.values(s.design.defs).find(
      (d) => d.kind === 'composite' && !d.variant && d.id !== 'main' && d.name === 'MyAdder',
    )
    expect(template).toBeDefined()

    // The clicked instance still references its own variant def.
    const ha1 = mainInstances().find((i) => i.id === 'ha1')!
    expect(s.design.defs[ha1.defId].variant).toBe(true)

    // The promoted template's internals are deep-copied (not shared with the instance).
    const instanceDef = s.design.defs[ha1.defId]
    const templateXor = template!.instances!.find((i) => i.id === 'ha-xor')!
    const instanceXor = instanceDef.instances!.find((i) => i.id === 'ha-xor')!
    expect(templateXor.defId).not.toBe(instanceXor.defId)
  })

  it('grouping deep-copies nested components so the instance is independent of the template', () => {
    reset()
    const state = useEditorStore.getState()
    state.setSelection(['ha1', 'and1'])
    state.openGroupDialog()
    state.setGroupName('combo')
    state.confirmGroup()

    const s = useEditorStore.getState()
    const template = Object.values(s.design.defs).find(
      (d) => d.kind === 'composite' && !d.variant && d.id !== 'main' && d.name === 'combo',
    )!
    const newInst = mainInstances()[mainInstances().length - 1]
    const variant = s.design.defs[newInst.defId]
    expect(variant.variant).toBe(true)

    const templateHa = template.instances!.find((i) => i.id === 'ha1')!
    const variantHa = variant.instances!.find((i) => i.id === 'ha1')!
    expect(variantHa.defId).not.toBe(templateHa.defId)
  })
})

// A design with a 5-input fan-in and an unconnected bus-split.
function makeSplitterDesign(): Design {
  const ports = []
  for (let i = 0; i < 5; i++) ports.push({ id: `in:${i}`, name: `A${i}`, direction: 'input' as const })
  ports.push({ id: 'out:0', name: 'BUS', direction: 'output' as const })
  const fanIn: ComponentDef = { id: 'fan-in-5', name: 'FAN-IN', kind: 'primitive', primitive: 'fan-in', ports }
  const split = primitiveDef('bus-split')
  const main: ComponentDef = {
    id: 'main',
    name: 'main',
    kind: 'composite',
    ports: [],
    instances: [
      { id: 'fi', name: 'fi', defId: 'fan-in-5', pos: { x: 0, y: 0 } },
      { id: 'bs', name: 'bs', defId: 'bus-split', pos: { x: 100, y: 0 } },
    ],
    connections: [],
  }
  return { version: 1, root: 'main', defs: { 'fan-in-5': fanIn, 'bus-split': split, main } }
}
