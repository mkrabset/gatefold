import { beforeEach, describe, expect, it } from 'vitest'
import type { CompositeDef, Design, Instance } from '@gatefold/model'
import { forkOf } from '@gatefold/model'
import { useEditorStore } from './editorStore'
import { useSimStore } from './simStore'

const inst = (id: string, kind: Parameters<typeof forkOf>[0]): Instance => ({
  id,
  name: id,
  def: forkOf(kind),
  pos: { x: 0, y: 0 },
})

function probeDesign(): Design {
  const main: CompositeDef = {
    id: 'main',
    name: 'main',
    kind: 'composite',
    ports: [],
    instances: [inst('clk', 'clock'), inst('p', 'probe')],
    connections: [{ id: 'c1', from: { instanceId: 'clk', portId: 'out:0' }, to: { instanceId: 'p', portId: 'in:0' } }],
  }
  return { version: 2, root: main, library: {} }
}

beforeEach(() => {
  useEditorStore.setState({ design: probeDesign(), navStack: [{ kind: 'root' }], selectedIds: [] })
  useSimStore.setState({ mode: 'design', engine: null, history: null, running: false, path: [] })
})

describe('simStore history lifecycle', () => {
  it('builds a fresh history when entering simulate mode', () => {
    const before = useSimStore.getState().history
    expect(before).toBeNull()

    useSimStore.getState().toggleMode()
    const history = useSimStore.getState().history
    expect(useSimStore.getState().mode).toBe('simulate')
    expect(history).not.toBeNull()
    expect(history!.labelCount).toBe(1)
    expect(history!.label(0)).toBe('p')
  })

  it('keeps the history after exiting simulate mode', () => {
    useSimStore.getState().toggleMode()
    const history = useSimStore.getState().history
    useSimStore.getState().toggleMode()

    expect(useSimStore.getState().mode).toBe('design')
    expect(useSimStore.getState().engine).toBeNull()
    expect(useSimStore.getState().history).toBe(history)
  })

  it('replaces the history on reset', () => {
    useSimStore.getState().toggleMode()
    const first = useSimStore.getState().history
    useSimStore.getState().reset()
    const second = useSimStore.getState().history

    expect(second).not.toBeNull()
    expect(second).not.toBe(first)
  })

  it('resets the probe order on a new simulation and keeps it across exit', () => {
    useSimStore.getState().toggleMode()
    useSimStore.getState().setProbeOrder(['p', 'clk'])
    expect(useSimStore.getState().probeOrder).toEqual(['p', 'clk'])

    // Leaving simulate mode keeps the order (the timeline still reads it).
    useSimStore.getState().toggleMode()
    expect(useSimStore.getState().mode).toBe('design')
    expect(useSimStore.getState().probeOrder).toEqual(['p', 'clk'])

    // Re-entering builds a fresh history and clears the order.
    useSimStore.getState().toggleMode()
    expect(useSimStore.getState().probeOrder).toBeNull()
  })
})
