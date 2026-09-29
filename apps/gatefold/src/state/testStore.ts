import { create } from 'zustand'
import type { PinRef } from '@gatefold/model'
import type { PendingWire, Rect, Viewport } from '../editor/types'

/**
 * Transient canvas state for the "Testing" tab (the test-bench sheet). The test-bench
 * *content* (instances/connections/main position) lives in `editorStore.design.testbench`
 * so it is undoable and serialized; this store holds only the ephemeral view/interaction
 * state (viewport, selection, marquee, pending wire, hover) that drives the canvas.
 */

interface TestState {
  viewport: Viewport
  selectedIds: string[]
  marquee: Rect | null
  pendingWire: PendingWire | null
  hoverPort: PinRef | null
  setViewport: (viewport: Viewport) => void
  setSelection: (ids: string[]) => void
  toggleSelected: (id: string) => void
  setMarquee: (rect: Rect | null) => void
  setPendingWire: (wire: PendingWire | null) => void
  setHoverPort: (hover: PinRef | null) => void
}

export const useTestStore = create<TestState>()((set) => ({
  viewport: { x: 0, y: 0, zoom: 1 },
  selectedIds: [],
  marquee: null,
  pendingWire: null,
  hoverPort: null,
  setViewport: (viewport) => set({ viewport }),
  setSelection: (selectedIds) => set({ selectedIds }),
  toggleSelected: (id) =>
    set((s) => {
      const i = s.selectedIds.indexOf(id)
      if (i >= 0) return { selectedIds: s.selectedIds.filter((x) => x !== id) }
      return { selectedIds: [...s.selectedIds, id] }
    }),
  setMarquee: (marquee) => set({ marquee }),
  setPendingWire: (pendingWire) => set({ pendingWire }),
  setHoverPort: (hoverPort) => set({ hoverPort }),
}))
