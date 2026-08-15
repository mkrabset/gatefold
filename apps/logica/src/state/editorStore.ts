import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { ComponentDef, Design, PinRef, Port, PortDirection } from '@logica/model'
import {
  PRIMITIVE_LIBRARY,
  applyGroup,
  findConnectionTo,
  inferGroup,
  inputPortDef,
  inputPortId,
  inputPorts,
  nextPortId,
  outputPortDef,
  outputPortId,
  outputPorts,
  primitiveDef,
} from '@logica/model'
import { instanceBounds } from '../editor/geometry'

/**
 * The document and editing state, in one Zustand store (with immer for ergonomic
 * mutation of the nested design). Holds the `Design`, the navigation stack into
 * composites, the viewport, and the selection/marquee. Undo/redo (zundo) is not yet
 * attached.
 */

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

/** Names captured in the group dialog while awaiting confirmation. */
interface PendingGroup {
  inputs: string[]
  outputs: string[]
}

/** A wire being drawn: anchored at `from`, with the cursor currently at (x, y). */
export interface PendingWire {
  from: PinRef
  x: number
  y: number
  /** When re-targeting an existing wire, its id (hidden from rendering while pending). */
  originalId?: string
}

export type HoverAction = 'create' | 'grab'

/** The port currently under the cursor, and what pressing there would do. */
export interface HoverPort {
  ref: PinRef
  action: HoverAction
}

interface EditorState {
  viewport: Viewport
  selectedIds: string[]
  marquee: Rect | null
  pendingWire: PendingWire | null
  hoverPort: HoverPort | null
  notice: string | null
  navStack: string[]
  design: Design
  pendingGroup: PendingGroup | null
  setViewport: (viewport: Viewport) => void
  setSelection: (ids: string[]) => void
  toggleSelected: (id: string) => void
  setInstancesPosition: (ids: string[], positions: { x: number; y: number }[]) => void
  setMarquee: (rect: Rect | null) => void
  setPendingWire: (wire: PendingWire | null) => void
  setHoverPort: (hover: HoverPort | null) => void
  setNotice: (message: string) => void
  clearNotice: () => void
  navigateTo: (defId: string) => void
  navigateUp: () => void
  openGroupDialog: () => void
  setGroupInputName: (index: number, name: string) => void
  setGroupOutputName: (index: number, name: string) => void
  confirmGroup: () => void
  cancelGroup: () => void
  renamePort: (portId: string, name: string) => void
  renameInstance: (id: string, name: string) => void
  addPort: (direction: PortDirection) => void
  removePort: (portId: string) => void
  setPortOrder: (direction: PortDirection, ids: string[]) => void
  addInstance: (defId: string, pos: { x: number; y: number }) => void
  addConnection: (from: PinRef, to: PinRef) => void
  retargetConnection: (id: string, to: PinRef) => void
  removeConnection: (id: string) => void
}

const iref = (instanceId: string, portId: string): PinRef => ({ instanceId, portId })

// Small helper for generating a name/id that is unique among a set of existing ones.
function uniqueAgainst(existing: Set<string>, base: string): string {
  if (!existing.has(base)) return base
  let i = 2
  while (existing.has(`${base}${i}`)) i++
  return `${base}${i}`
}

// Default placement for a newly-added port group: just outside the component bounds
// (inputs to the left of the leftmost component, outputs to the right of the rightmost).
function portPlacement(def: ComponentDef, design: Design, direction: PortDirection): { x: number; y: number } {
  const insts = def.instances ?? []
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const inst of insts) {
    const instDef = design.defs[inst.defId]
    // Ignore existing port groups so placement is relative to real components only.
    if (instDef.primitive === 'input-port' || instDef.primitive === 'output-port') continue
    const b = instanceBounds(def, inst, instDef)
    minX = Math.min(minX, b.x)
    maxX = Math.max(maxX, b.x + b.w)
    minY = Math.min(minY, b.y)
    maxY = Math.max(maxY, b.y + b.h)
  }
  if (!Number.isFinite(minX)) {
    return { x: direction === 'input' ? -60 : 60, y: 0 }
  }
  const cy = (minY + maxY) / 2
  return { x: direction === 'input' ? minX - 80 : maxX + 80, y: cy }
}

/** A small demo design so the app has content to render before save/load exists. */
function createDemoDesign(): Design {
  const defs: Record<string, ComponentDef> = {}
  for (const spec of PRIMITIVE_LIBRARY) {
    defs[spec.kind] = primitiveDef(spec.kind)
  }
  defs['input-port'] = inputPortDef()
  defs['output-port'] = outputPortDef()

  defs['half-adder'] = {
    id: 'half-adder',
    name: 'half-adder',
    kind: 'composite',
    ports: [
      { id: inputPortId(0), name: 'A', direction: 'input', terminal: { instanceId: 'ha-in', pinId: 'in:0' } },
      { id: inputPortId(1), name: 'B', direction: 'input', terminal: { instanceId: 'ha-in', pinId: 'in:1' } },
      { id: outputPortId(0), name: 'S', direction: 'output', terminal: { instanceId: 'ha-out', pinId: 'out:0' } },
      { id: outputPortId(1), name: 'C', direction: 'output', terminal: { instanceId: 'ha-out', pinId: 'out:1' } },
    ],
    instances: [
      { id: 'ha-in', name: '', defId: 'input-port', pos: { x: 60, y: 250 } },
      { id: 'ha-xor', name: 'xor1', defId: 'xor', pos: { x: 140, y: 180 } },
      { id: 'ha-and', name: 'and1', defId: 'and', pos: { x: 140, y: 320 } },
      { id: 'ha-out', name: '', defId: 'output-port', pos: { x: 220, y: 250 } },
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
    viewport: { x: 400, y: 250, zoom: 1 },
    selectedIds: [],
    marquee: null,
    pendingWire: null,
    hoverPort: null,
    notice: null,
    navStack: ['main'],
    design: createDemoDesign(),
    pendingGroup: null,
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
    setPendingWire: (wire) => set((s) => void (s.pendingWire = wire)),
    setHoverPort: (hover) => set((s) => void (s.hoverPort = hover)),
    setNotice: (message) => set((s) => void (s.notice = message)),
    clearNotice: () => set((s) => void (s.notice = null)),
    navigateTo: (defId) =>
      set((s) => {
        s.navStack.push(defId)
        s.selectedIds = []
        s.marquee = null
        s.pendingWire = null
        s.hoverPort = null
      }),
    navigateUp: () =>
      set((s) => {
        if (s.navStack.length > 1) {
          s.navStack.pop()
          s.selectedIds = []
          s.marquee = null
          s.pendingWire = null
          s.hoverPort = null
        }
      }),
    openGroupDialog: () =>
      set((s) => {
        // Infer the ports from the current selection and seed default names for the
        // dialog; the actual transformation happens on `confirmGroup`.
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
        // applyGroup returns a fresh design (pure); assign it wholesale and select
        // the newly created instance, which is appended last in the parent.
        s.design = applyGroup(s.design, defId, s.selectedIds, inputs, outputs)
        s.pendingGroup = null
        const def = s.design.defs[defId]
        const last = def.instances?.[def.instances.length - 1]
        if (last) {
          // Place the new composite's port groups relative to its components: inputs
          // left of the leftmost input pin, outputs right of the rightmost output pin.
          const newDef = s.design.defs[last.defId]
          for (const inst of newDef.instances ?? []) {
            if (inst.defId === 'input-port') inst.pos = portPlacement(newDef, s.design, 'input')
            else if (inst.defId === 'output-port') inst.pos = portPlacement(newDef, s.design, 'output')
          }
        }
        s.selectedIds = last ? [last.id] : []
      }),
    cancelGroup: () => set((s) => void (s.pendingGroup = null)),
    renamePort: (portId, name) =>
      set((s) => {
        const def = s.design.defs[currentDefId(s)]
        const port = def.ports.find((p) => p.id === portId)
        if (port) port.name = name
      }),
    renameInstance: (id, name) =>
      set((s) => {
        const def = s.design.defs[currentDefId(s)]
        const inst = def.instances?.find((x) => x.id === id)
        if (inst) inst.name = name
      }),
    addPort: (direction) =>
      set((s) => {
        const def = s.design.defs[currentDefId(s)]
        if (def.kind !== 'composite') return
        const count = direction === 'input' ? inputPorts(def).length : outputPorts(def).length
        const portId = nextPortId(def, direction)
        const name = direction === 'input' ? `in${count + 1}` : `out${count + 1}`
        if (!def.instances) def.instances = []
        const groupDefId = direction === 'input' ? 'input-port' : 'output-port'
        let group = def.instances.find((i) => i.defId === groupDefId)
        if (!group) {
          group = {
            id: uniqueAgainst(
              new Set(def.instances.map((i) => i.id)),
              direction === 'input' ? 'port-in' : 'port-out',
            ),
            name: '',
            defId: groupDefId,
            pos: portPlacement(def, s.design, direction),
          }
          def.instances.push(group)
        }
        const port: Port = {
          id: portId,
          name,
          direction,
          terminal: { instanceId: group.id, pinId: portId },
        }
        // Keep the ports array ordered: inputs first, then outputs.
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
        const port = def.ports.find((p) => p.id === portId)
        def.ports = def.ports.filter((p) => p.id !== portId)
        const instId = port?.terminal?.instanceId
        if (instId) {
          // Drop any connections touching this port's group pin.
          def.connections = (def.connections ?? []).filter(
            (c) =>
              !(c.from.instanceId === instId && c.from.portId === portId) &&
              !(c.to.instanceId === instId && c.to.portId === portId),
          )
          // If no ports of that direction remain, remove the group instance.
          const remaining = port?.direction === 'input' ? inputPorts(def).length : outputPorts(def).length
          if (remaining === 0) {
            def.instances = (def.instances ?? []).filter((i) => i.id !== instId)
          }
        }
      }),
    setPortOrder: (direction, ids) =>
      set((s) => {
        const def = s.design.defs[currentDefId(s)]
        if (def.kind !== 'composite') return
        const byId = new Map(def.ports.map((p) => [p.id, p]))
        const ordered = ids.map((id) => byId.get(id)).filter((p): p is Port => !!p)
        const inputs = inputPorts(def)
        const outputs = outputPorts(def)
        // Replace the matching section of the ordered port list.
        def.ports = direction === 'input' ? [...ordered, ...outputs] : [...inputs, ...ordered]
      }),
    addInstance: (defId, pos) =>
      set((s) => {
        const def = s.design.defs[currentDefId(s)]
        const srcDef = s.design.defs[defId]
        if (!def.instances) def.instances = []
        const base = srcDef.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'component'
        const name = uniqueAgainst(new Set(def.instances.map((i) => i.name)), base)
        const id = uniqueAgainst(new Set(def.instances.map((i) => i.id)), name)
        def.instances.push({ id, name, defId, pos: { x: pos.x, y: pos.y } })
        s.selectedIds = [id]
      }),
    addConnection: (from, to) =>
      set((s) => {
        const def = s.design.defs[currentDefId(s)]
        if (!def.connections) def.connections = []
        // Enforce the single-driver invariant: reject if the target is already driven.
        if (findConnectionTo(def.connections, to)) {
          s.notice = 'Input already has a driver'
          return
        }
        const ids = new Set(def.connections.map((c) => c.id))
        let i = def.connections.length + 1
        while (ids.has(`c${i}`)) i++
        def.connections.push({ id: `c${i}`, from, to })
      }),
    retargetConnection: (id, to) =>
      set((s) => {
        const def = s.design.defs[currentDefId(s)]
        const conns = def.connections ?? []
        const original = conns.find((c) => c.id === id)
        if (!original) return
        const conflict = findConnectionTo(conns, to)
        if (conflict && conflict.id !== id) {
          s.notice = 'Input already has a driver'
          return
        }
        original.to = to
      }),
    removeConnection: (id) =>
      set((s) => {
        const def = s.design.defs[currentDefId(s)]
        def.connections = (def.connections ?? []).filter((c) => c.id !== id)
      }),
  })),
)

/** The definition currently being viewed/edited (top of the navigation stack). */
export function currentDefId(state: EditorState): string {
  return state.navStack[state.navStack.length - 1]
}
