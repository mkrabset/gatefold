import { describe, expect, it } from 'vitest'
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
})
