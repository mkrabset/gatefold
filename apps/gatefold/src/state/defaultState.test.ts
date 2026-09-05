import { beforeEach, describe, expect, it } from 'vitest'
import { serializeDesign } from '@gatefold/model'
import {
  DEFAULT_STATE_KEY,
  clearDefaultState,
  readDefaultState,
  repairDesign,
  saveDefaultState,
} from './defaultState'
import { createDemoDesign, useEditorStore } from './editorStore'

describe('default state (localStorage persistence)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns null when no default is stored', () => {
    expect(readDefaultState()).toBeNull()
  })

  it('round-trips a design through save/read', () => {
    const design = createDemoDesign()
    expect(saveDefaultState(design)).toBe(true)

    const restored = readDefaultState()
    expect(restored).toEqual(design)
  })

  it('clears a stored default', () => {
    saveDefaultState(createDemoDesign())
    expect(readDefaultState()).not.toBeNull()

    expect(clearDefaultState()).toBe(true)
    expect(readDefaultState()).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    localStorage.setItem(DEFAULT_STATE_KEY, 'not json {')
    expect(readDefaultState()).toBeNull()
  })

  it('returns null for valid JSON that is not a design', () => {
    localStorage.setItem(DEFAULT_STATE_KEY, '{"foo": 1}')
    expect(readDefaultState()).toBeNull()
  })

  it('repairDesign backfills missing lineage ids and strips orphaned defs', () => {
    const design = createDemoDesign()
    // Simulate an older save: no uuid on the root, plus an orphaned def.
    delete (design.defs['main'] as { uuid?: string }).uuid
    design.defs['orphan'] = { id: 'orphan', name: 'orphan', kind: 'composite', ports: [], instances: [], connections: [] }

    const repaired = repairDesign(serializeDesign(design)).design
    expect((repaired.defs['main'] as { uuid?: string }).uuid).toBeDefined()
    expect(repaired.defs['orphan']).toBeUndefined()
  })
})

describe('editorStore save/clear default actions', () => {
  beforeEach(() => {
    localStorage.clear()
    useEditorStore.setState({ design: createDemoDesign() })
  })

  it('saveDefault persists the design and sets a notice', () => {
    const design = useEditorStore.getState().design
    useEditorStore.getState().saveDefault()
    expect(readDefaultState()).toEqual(design)
    expect(useEditorStore.getState().notice).toBe('Default state saved')
  })

  it('clearDefault removes the stored design and sets a notice', () => {
    useEditorStore.getState().saveDefault()
    useEditorStore.getState().clearDefault()
    expect(readDefaultState()).toBeNull()
    expect(useEditorStore.getState().notice).toBe('Default state cleared')
  })
})
