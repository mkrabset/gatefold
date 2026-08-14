import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { ComponentDef, Design, PinRef, Port, PortDirection } from '@logica/model'
import {
  PRIMITIVE_LIBRARY,
  applyGroup,
  inferGroup,
  inputPortId,
  inputPorts,
  nextPortId,
  outputPortId,
  outputPorts,
  primitiveDef,
} from '@logica/model'

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

interface PendingGroup {
  inputs: string[]
  outputs: string[]
}

interface EditorState {
  tool: Tool
  viewport: Viewport
  selectedIds: string[]
  marquee: Rect | null
  navStack: string[]
  design: Design
  pendingGroup: PendingGroup | null
  setTool: (tool: Tool) => void
  setViewport: (viewport: Viewport) => void
  setSelection: (ids: string[]) => void
  toggleSelected: (id: string) => void
  setInstancesPosition: (ids: string[], positions: { x: number; y: number }[]) => void
  setMarquee: (rect: Rect | null) => void
  navigateTo: (defId: string) => void
  navigateUp: () => void
  openGroupDialog: () => void
  setGroupInputName: (index: number, name: string) => void
  setGroupOutputName: (index: number, name: string) => void
  confirmGroup: () => void
  cancelGroup: () => void
  renamePort: (portId: string, name: string) => void
  addPort: (direction: PortDirection) => void
  removePort: (portId: string) => void
}

const iref = (instanceId: string, portId: string): PinRef => ({ kind: 'instance', instanceId, portId })

function createDemoDesign(): Design {
  const defs: Record<string, ComponentDef> = {}
  for (const spec of PRIMITIVE_LIBRARY) {
    defs[spec.kind] = primitiveDef(spec.kind)
  }

  defs['half-adder'] = {
    id: 'half-adder',
    name: 'half-adder',
    kind: 'composite',
    ports: [
      { id: inputPortId(0), name: 'A', direction: 'input' },
      { id: inputPortId(1), name: 'B', direction: 'input' },
      { id: outputPortId(0), name: 'S', direction: 'output' },
      { id: outputPortId(1), name: 'C', direction: 'output' },
    ],
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
    ports: [],
    instances: [
      { id: 'clk', name: 'clk', defId: 'clock', pos: { x: 100, y: 200 } },
      { id: 'inv1', name: 'inv1', defId: 'not', pos: { x: 300, y: 100 } },
      { id: 'and1', name: 'and1', defId: 'and', pos: { x: 300, y: 330 } },
      { id: 'xor1', name: 'xor1', defId: 'xor', pos: { x: 500, y: 150 } },
      { id: 'ha1', name: 'ha1', defId: 'half-adder', pos: { x: 500, y: 360 } },
      { id: 'or1', name: 'or1', defId: 'or', pos: { x: 730, y: 250 } },
    ],
    connections: [
      { id: 'c1', from: iref('clk', 'out:0'), to: iref('inv1', 'in:0') },
      { id: 'c2', from: iref('clk', 'out:0'), to: iref('and1', 'in:0') },
      { id: 'c3', from: iref('inv1', 'out:0'), to: iref('and1', 'in:1') },
      { id: 'c4', from: iref('clk', 'out:0'), to: iref('xor1', 'in:0') },
      { id: 'c5', from: iref('inv1', 'out:0'), to: iref('xor1', 'in:1') },
      { id: 'c6', from: iref('and1', 'out:0'), to: iref('or1', 'in:0') },
      { id: 'c7', from: iref('xor1', 'out:0'), to: iref('or1', 'in:1') },
      { id: 'c8', from: iref('clk', 'out:0'), to: iref('ha1', 'in:0') },
      { id: 'c9', from: iref('inv1', 'out:0'), to: iref('ha1', 'in:1') },
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
    pendingGroup: null,
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
        const def = s.design.defs[currentDefId(s)]
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
    openGroupDialog: () =>
      set((s) => {
        const g = inferGroup(s.design, currentDefId(s), s.selectedIds)
        s.pendingGroup = {
          inputs: g.inputs.map((_, i) => `in${i + 1}`),
          outputs: g.outputs.map((_, i) => `out${i + 1}`),
        }
      }),
    setGroupInputName: (index, name) =>
      set((s) => {
        if (s.pendingGroup) s.pendingGroup.inputs[index] = name
      }),
    setGroupOutputName: (index, name) =>
      set((s) => {
        if (s.pendingGroup) s.pendingGroup.outputs[index] = name
      }),
    confirmGroup: () =>
      set((s) => {
        if (!s.pendingGroup) return
        const defId = currentDefId(s)
        const { inputs, outputs } = s.pendingGroup
        s.design = applyGroup(s.design, defId, s.selectedIds, inputs, outputs)
        s.pendingGroup = null
        const def = s.design.defs[defId]
        const last = def.instances?.[def.instances.length - 1]
        s.selectedIds = last ? [last.id] : []
      }),
    cancelGroup: () => set((s) => void (s.pendingGroup = null)),
    renamePort: (portId, name) =>
      set((s) => {
        const def = s.design.defs[currentDefId(s)]
        const port = def.ports.find((p) => p.id === portId)
        if (port) port.name = name
      }),
    addPort: (direction) =>
      set((s) => {
        const def = s.design.defs[currentDefId(s)]
        if (def.kind !== 'composite') return
        const count = direction === 'input' ? inputPorts(def).length : outputPorts(def).length
        const port: Port = {
          id: nextPortId(def, direction),
          name: direction === 'input' ? `in${count + 1}` : `out${count + 1}`,
          direction,
        }
        if (direction === 'input') {
          const outStart = def.ports.findIndex((p) => p.direction === 'output')
          if (outStart === -1) def.ports.push(port)
          else def.ports.splice(outStart, 0, port)
        } else {
          def.ports.push(port)
        }
      }),
    removePort: (portId) =>
      set((s) => {
        const def = s.design.defs[currentDefId(s)]
        if (def.kind !== 'composite') return
        def.ports = def.ports.filter((p) => p.id !== portId)
        def.connections = (def.connections ?? []).filter((c) => {
          const touches = (r: PinRef) => r.kind === 'port' && r.portId === portId
          return !touches(c.from) && !touches(c.to)
        })
      }),
  })),
)

export function currentDefId(state: EditorState): string {
  return state.navStack[state.navStack.length - 1]
}
