import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { ComponentDef, Design } from '@logica/model'
import { PRIMITIVE_LIBRARY, primitiveDef } from '@logica/model'

export type Tool = 'select' | 'wire' | 'pan'

export interface Viewport {
  x: number
  y: number
  zoom: number
}

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

interface EditorState {
  tool: Tool
  viewport: Viewport
  selectedIds: string[]
  marquee: Rect | null
  navStack: string[]
  design: Design
  setTool: (tool: Tool) => void
  setViewport: (viewport: Viewport) => void
  setSelection: (ids: string[]) => void
  toggleSelected: (id: string) => void
  setInstancesPosition: (ids: string[], positions: { x: number; y: number }[]) => void
  setMarquee: (rect: Rect | null) => void
  navigateTo: (defId: string) => void
  navigateUp: () => void
}

function createDemoDesign(): Design {
  const defs: Record<string, ComponentDef> = {}
  for (const spec of PRIMITIVE_LIBRARY) {
    defs[spec.kind] = primitiveDef(spec.kind)
  }

  defs['half-adder'] = {
    id: 'half-adder',
    name: 'half-adder',
    kind: 'composite',
    inputs: 2,
    outputs: 2,
    instances: [
      { id: 'ha-xor', name: 'xor1', defId: 'xor', pos: { x: 120, y: 180 } },
      { id: 'ha-and', name: 'and1', defId: 'and', pos: { x: 120, y: 320 } },
    ],
    connections: [],
  }

  defs['main'] = {
    id: 'main',
    name: 'main',
    kind: 'composite',
    inputs: 0,
    outputs: 0,
    instances: [
      { id: 'clk', name: 'clk', defId: 'clock', pos: { x: 100, y: 200 } },
      { id: 'inv1', name: 'inv1', defId: 'not', pos: { x: 300, y: 100 } },
      { id: 'and1', name: 'and1', defId: 'and', pos: { x: 300, y: 330 } },
      { id: 'xor1', name: 'xor1', defId: 'xor', pos: { x: 500, y: 150 } },
      { id: 'ha1', name: 'ha1', defId: 'half-adder', pos: { x: 500, y: 360 } },
      { id: 'or1', name: 'or1', defId: 'or', pos: { x: 730, y: 250 } },
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

  return { version: 1, root: 'main', defs }
}

export const useEditorStore = create<EditorState>()(
  immer((set) => ({
    tool: 'select',
    viewport: { x: 400, y: 250, zoom: 1 },
    selectedIds: [],
    marquee: null,
    navStack: ['main'],
    design: createDemoDesign(),
    setTool: (tool) => set((s) => void (s.tool = tool)),
    setViewport: (viewport) => set((s) => void (s.viewport = viewport)),
    setSelection: (ids) => set((s) => void (s.selectedIds = ids)),
    toggleSelected: (id) =>
      set((s) => {
        const i = s.selectedIds.indexOf(id)
        if (i >= 0) s.selectedIds.splice(i, 1)
        else s.selectedIds.push(id)
      }),
    setInstancesPosition: (ids, positions) =>
      set((s) => {
        const def = s.design.defs[s.navStack[s.navStack.length - 1]]
        ids.forEach((id, i) => {
          const inst = def.instances?.find((x) => x.id === id)
          if (inst) {
            inst.pos = positions[i]
          }
        })
      }),
    setMarquee: (rect) => set((s) => void (s.marquee = rect)),
    navigateTo: (defId) =>
      set((s) => {
        s.navStack.push(defId)
        s.selectedIds = []
        s.marquee = null
      }),
    navigateUp: () =>
      set((s) => {
        if (s.navStack.length > 1) {
          s.navStack.pop()
          s.selectedIds = []
          s.marquee = null
        }
      }),
  })),
)

export function currentDefId(state: EditorState): string {
  return state.navStack[state.navStack.length - 1]
}
