import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { temporal } from 'zundo'
import type { ComponentDef, Design, PinRef, Port, PortDirection } from '@logica/model'
import {
  allowRenameTerminals,
  applyGroup,
  captureClipboard,
  cloneDef,
  copyDefSubgraph,
  defaultPropsOf,
  exportLibrary as buildLibraryFile,
  findConnectionTo,
  importLibrary as mergeLibrary,
  inferGroup,
  inputPortDef,
  inputPortId,
  inputPorts,
  instantiateClipboard,
  isArityFixed,
  isDefReferenced,
  isPortGroupDef,
  libraryPrimitives,
  nextPortId,
  nextPrimitiveInputName,
  outputPortDef,
  outputPortId,
  outputPorts,
  parseDesign,
  parseLibrary,
  primitiveDef,
  sanitizeDesign,
  serializeDesign,
  serializeLibrary,
  uniqueId,
  withBuiltinPrimitives,
} from '@logica/model'
import type { Clipboard } from '@logica/model'
import { instanceBounds } from '../editor/geometry'
import { connectionError } from '../editor/widths'

/**
 * The document and editing state, in one Zustand store (with immer for ergonomic
 * mutation of the nested design, and zundo for undo/redo over the design). Holds the
 * `Design`, the navigation stack into composites, the viewport, and the
 * selection/marquee.
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

/** Values captured in the group dialog while awaiting confirmation. */
interface PendingGroup {
  name: string
  inputs: string[]
  outputs: string[]
  /** True when promoting a single custom component instance to a template. */
  promote: boolean
  /** The def to promote (set when `promote` is true). */
  promoteDefId: string | null
}

/** A wire being drawn: anchored at `from`, with the cursor currently at (x, y). */
export interface PendingWire {
  from: PinRef
  x: number
  y: number
  /** When re-targeting an existing wire, its id (hidden from rendering while pending). */
  originalId?: string
}

export type HoverAction = 'create' | 'grab' | 'inspect'

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
  pendingDelete: string | null
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
  setGroupName: (name: string) => void
  setGroupInputName: (index: number, name: string) => void
  setGroupOutputName: (index: number, name: string) => void
  confirmGroup: () => void
  cancelGroup: () => void
  requestDeleteTemplate: (defId: string) => void
  confirmDeleteTemplate: () => void
  cancelDeleteTemplate: () => void
  renamePort: (portId: string, name: string) => void
  setPortInverted: (portId: string, inverted: boolean) => void
  togglePinInversion: (ref: PinRef) => void
  renameInstance: (id: string, name: string) => void
  renameDef: (defId: string, name: string) => void
  setInstanceProp: (id: string, name: string, value: unknown) => void
  addPort: (direction: PortDirection) => void
  removePort: (portId: string) => void
  setPortOrder: (direction: PortDirection, ids: string[]) => void
  addInstance: (defId: string, pos: { x: number; y: number }) => void
  addConnection: (from: PinRef, to: PinRef) => void
  retargetConnection: (id: string, to: PinRef) => void
  removeConnection: (id: string) => void
  deleteSelection: () => void
  copySelection: () => void
  paste: () => void
  saveProject: () => void
  loadProject: (json: string) => void
  exportLibrary: () => void
  importLibrary: (json: string) => void
}

const iref = (instanceId: string, portId: string): PinRef => ({ instanceId, portId })

// Trigger a browser download of `text` as a file named `filename`.
function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// In-memory clipboard (not part of the undoable design state).
let clipboard: Clipboard | null = null
let pasteOffset = 0

// Drag coalescing: while `coalescingMove` is true, only the first design change is
// recorded in the undo history (so a whole drag is a single undo step).
let coalescingMove = false
let skipMoveRecording = false

/** Begin coalescing a drag into a single undo step. */
export function beginMoveTransaction(): void {
  coalescingMove = true
  skipMoveRecording = false
}

/** End the drag coalescing; subsequent changes record normally again. */
export function endMoveTransaction(): void {
  coalescingMove = false
  skipMoveRecording = false
}

// Small helper for generating a name/id that is unique among a set of existing ones.
const uniqueAgainst = (existing: Set<string>, base: string): string => uniqueId(existing, base, '')

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
    if (isPortGroupDef(instDef)) continue
    const b = instanceBounds(design, def, inst, instDef)
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

/** Copy a template def into a variant (instance-local) def, returning the new id. */
function variantize(defs: Record<string, ComponentDef>, templateId: string, suffix: string): string {
  const copyId = `${templateId}~${suffix}`
  const copy = cloneDef(defs[templateId])
  copy.id = copyId
  copy.variant = true
  defs[copyId] = copy
  return copyId
}

/** A small demo design so the app has content to render before save/load exists. */
export function createDemoDesign(): Design {
  const defs: Record<string, ComponentDef> = {}
  for (const spec of libraryPrimitives()) {
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
      { id: 'clk', name: 'clk', defId: variantize(defs, 'clock', 'clk'), pos: { x: 100, y: 200 }, props: { period: 1000 } },
      { id: 'inv1', name: 'inv1', defId: variantize(defs, 'not', 'inv1'), pos: { x: 300, y: 100 } },
      { id: 'and1', name: 'and1', defId: variantize(defs, 'and', 'and1'), pos: { x: 300, y: 330 } },
      { id: 'xor1', name: 'xor1', defId: variantize(defs, 'xor', 'xor1'), pos: { x: 500, y: 150 } },
      { id: 'ha1', name: 'ha1', defId: variantize(defs, 'half-adder', 'ha1'), pos: { x: 500, y: 360 } },
      { id: 'or1', name: 'or1', defId: variantize(defs, 'or', 'or1'), pos: { x: 730, y: 250 } },
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
  temporal(
    immer((set, get) => ({
      viewport: { x: 400, y: 250, zoom: 1 },
      selectedIds: [],
      marquee: null,
    pendingWire: null,
    hoverPort: null,
    notice: null,
    navStack: ['main'],
    design: createDemoDesign(),
    pendingGroup: null,
    pendingDelete: null,
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
        const defId = currentDefId(s)
        const def = s.design.defs[defId]

        // A single selected custom component is promoted to a template rather than
        // wrapped in a new layer of ports.
        if (s.selectedIds.length === 1) {
          const inst = def.instances?.find((i) => i.id === s.selectedIds[0])
          const instDef = inst && s.design.defs[inst.defId]
          if (inst && instDef && instDef.kind === 'composite') {
            s.pendingGroup = {
              name: instDef.name,
              inputs: [],
              outputs: [],
              promote: true,
              promoteDefId: inst.defId,
            }
            return
          }
        }

        // Infer the ports from the current selection and seed default names for the
        // dialog; the actual transformation happens on `confirmGroup`. Port-group
        // instances are never grouped — ignore a selection with no real components.
        const movable = s.selectedIds.filter((id) => {
          const inst = def.instances?.find((i) => i.id === id)
          const instDef = inst && s.design.defs[inst.defId]
          return !!instDef && !isPortGroupDef(instDef)
        })
        if (movable.length === 0) return

        const g = inferGroup(s.design, defId, s.selectedIds)
        s.pendingGroup = {
          name: 'component',
          inputs: g.inputs.map((x, i) => x.name || `in${i + 1}`),
          outputs: g.outputs.map((x, i) => x.name || `out${i + 1}`),
          promote: false,
          promoteDefId: null,
        }
      }),
    setGroupName: (name) =>
      set((s) => {
        if (s.pendingGroup) s.pendingGroup.name = name
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
        const p = s.pendingGroup

        // Promote a single custom component instance to a template: deep-copy the
        // instance's def (and its whole hierarchy) into a fresh template, leaving the
        // instance and its variant untouched.
        if (p.promote && p.promoteDefId) {
          const target = s.design.defs[p.promoteDefId]
          if (target) {
            const name = uniqueAgainst(
              new Set(Object.values(s.design.defs).map((d) => d.name)),
              p.name.trim() || target.name,
            )
            const usedIds = new Set(Object.keys(s.design.defs))
            const { defs, idMap } = copyDefSubgraph(s.design.defs, [p.promoteDefId], usedIds)
            for (const [copyId, d] of Object.entries(defs)) {
              s.design.defs[copyId] = d
            }
            const top = s.design.defs[idMap.get(p.promoteDefId) ?? p.promoteDefId]
            top.name = name
            top.variant = false
          }
          s.pendingGroup = null
          return
        }

        const defId = currentDefId(s)
        const { name, inputs, outputs } = p
        // applyGroup returns a fresh design (pure); assign it wholesale and select
        // the newly created instance, which is appended last in the parent.
        s.design = applyGroup(s.design, defId, s.selectedIds, inputs, outputs, name)
        s.pendingGroup = null
        const def = s.design.defs[defId]
        const last = def.instances?.[def.instances.length - 1]
        if (last) {
          // Copy-on-place: deep-copy the template and its whole hierarchy into fresh
          // variants so the grouped instance is fully independent of the library template.
          const usedIds = new Set(Object.keys(s.design.defs))
          const { defs, idMap } = copyDefSubgraph(s.design.defs, [last.defId], usedIds)
          for (const [copyId, d] of Object.entries(defs)) {
            s.design.defs[copyId] = d
          }
          const newDefId = idMap.get(last.defId) ?? last.defId
          last.defId = newDefId
          // Place the new composite's port groups relative to its components: inputs
          // left of the leftmost input pin, outputs right of the rightmost output pin.
          const newDef = s.design.defs[newDefId]
          for (const inst of newDef.instances ?? []) {
            if (inst.defId === 'input-port') inst.pos = portPlacement(newDef, s.design, 'input')
            else if (inst.defId === 'output-port') inst.pos = portPlacement(newDef, s.design, 'output')
          }
        }
        s.selectedIds = last ? [last.id] : []
      }),
    cancelGroup: () => set((s) => void (s.pendingGroup = null)),
    requestDeleteTemplate: (defId) => set((s) => void (s.pendingDelete = defId)),
    cancelDeleteTemplate: () => set((s) => void (s.pendingDelete = null)),
    confirmDeleteTemplate: () =>
      set((s) => {
        if (!s.pendingDelete) return
        const id = s.pendingDelete
        s.pendingDelete = null
        if (id === s.design.root) return
        if (s.navStack.includes(id)) {
          s.notice = 'Exit the component before deleting it'
          return
        }
        if (isDefReferenced(s.design, id)) {
          s.notice = 'Component is in use'
          return
        }
        delete s.design.defs[id]
      }),
    renamePort: (portId, name) =>
      set((s) => {
        const def = s.design.defs[currentDefId(s)]
        if (!allowRenameTerminals(def)) return
        const port = def.ports.find((p) => p.id === portId)
        if (port) port.name = name
      }),
    setPortInverted: (portId, inverted) =>
      set((s) => {
        const def = s.design.defs[currentDefId(s)]
        const port = def.ports.find((p) => p.id === portId)
        if (!port) return
        if (inverted) port.inverted = true
        else delete port.inverted
      }),
    togglePinInversion: (ref) =>
      set((s) => {
        const def = s.design.defs[currentDefId(s)]
        const inst = def.instances?.find((i) => i.id === ref.instanceId)
        if (!inst) return
        const instDef = s.design.defs[inst.defId]
        if (!instDef) return
        // A port-group pin is derived from the current composite's own port.
        const ownerDef = isPortGroupDef(instDef) ? def : instDef
        const port = ownerDef.ports.find((p) => p.id === ref.portId)
        if (!port) return
        if (port.inverted) delete port.inverted
        else port.inverted = true
      }),
    renameInstance: (id, name) =>
      set((s) => {
        const def = s.design.defs[currentDefId(s)]
        const inst = def.instances?.find((x) => x.id === id)
        if (inst) inst.name = name
      }),
    renameDef: (defId, name) =>
      set((s) => {
        const def = s.design.defs[defId]
        // Only composite templates (not the root, not primitives, not variant copies)
        // are renameable.
        if (!def || def.kind !== 'composite' || def.variant === true || defId === s.design.root) return
        def.name = name
      }),
    setInstanceProp: (id, name, value) =>
      set((s) => {
        const def = s.design.defs[currentDefId(s)]
        const inst = def.instances?.find((x) => x.id === id)
        if (!inst) return
        if (!inst.props) inst.props = {}
        inst.props[name] = value
      }),
    addPort: (direction) =>
      set((s) => {
        const def = s.design.defs[currentDefId(s)]
        if (isArityFixed(def, direction)) return
        const count = direction === 'input' ? inputPorts(def).length : outputPorts(def).length
        const portId = nextPortId(def, direction)
        const name = direction === 'input' ? nextPrimitiveInputName(def) ?? `in${count + 1}` : `out${count + 1}`
        let terminal: Port['terminal']
        // For composites, back the port with a pin on the port-group instance.
        if (def.kind === 'composite') {
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
          terminal = { instanceId: group.id, pinId: portId }
        }
        const port: Port = { id: portId, name, direction, terminal }
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
        const port = def.ports.find((p) => p.id === portId)
        if (port && isArityFixed(def, port.direction)) return
        def.ports = def.ports.filter((p) => p.id !== portId)
        if (def.kind !== 'composite') return
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
        // Deep copy-on-place: the instance gets its own variant def *and* a copy of
        // its whole internal hierarchy, independent of the library template.
        const usedIds = new Set(Object.keys(s.design.defs))
        const { defs, idMap } = copyDefSubgraph(s.design.defs, [defId], usedIds)
        for (const [copyId, d] of Object.entries(defs)) {
          s.design.defs[copyId] = d
        }
        const newDefId = idMap.get(defId) ?? defId
        const props = srcDef.kind === 'primitive' && srcDef.primitive ? defaultPropsOf(srcDef.primitive) : {}
        def.instances.push({ id, name, defId: newDefId, pos: { x: pos.x, y: pos.y }, ...(Object.keys(props).length ? { props } : {}) })
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
        // Width must be consistent (and splitters require even buses).
        const err = connectionError(s.design, def, from, to)
        if (err) {
          s.notice = err
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
        const err = connectionError(s.design, def, original.from, to)
        if (err) {
          s.notice = err
          return
        }
        original.to = to
      }),
    removeConnection: (id) =>
      set((s) => {
        const def = s.design.defs[currentDefId(s)]
        def.connections = (def.connections ?? []).filter((c) => c.id !== id)
      }),
    deleteSelection: () =>
      set((s) => {
        const def = s.design.defs[currentDefId(s)]
        const deleted = new Set<string>()
        for (const id of s.selectedIds) {
          const inst = def.instances?.find((i) => i.id === id)
          if (!inst) continue
          const instDef = s.design.defs[inst.defId]
          if (!instDef) continue
          const isPortGroup = isPortGroupDef(instDef)
          if (!isPortGroup) deleted.add(id)
        }
        def.instances = (def.instances ?? []).filter((i) => !deleted.has(i.id))
        def.connections = (def.connections ?? []).filter(
          (c) => !deleted.has(c.from.instanceId) && !deleted.has(c.to.instanceId),
        )
        s.selectedIds = []
      }),
    copySelection: () => {
      const s = get()
      const clip = captureClipboard(s.design, currentDefId(s), s.selectedIds)
      if (clip) {
        clipboard = clip
        pasteOffset = 0
      }
    },
    paste: () =>
      set((s) => {
        if (!clipboard) return
        pasteOffset += 24
        const { design, newIds } = instantiateClipboard(s.design, currentDefId(s), clipboard, {
          x: pasteOffset,
          y: pasteOffset,
        })
        s.design = design
        s.selectedIds = newIds
      }),
    saveProject: () => {
      const s = get()
      downloadText('design.logica.json', serializeDesign(s.design))
    },
    loadProject: (json) => {
      try {
        const { design, issues } = sanitizeDesign(withBuiltinPrimitives(parseDesign(json)))
        if (issues.length > 0) {
          console.warn('Design repaired on load:', issues)
        }
        set((s) => {
          s.design = design
          s.navStack = [design.root]
          s.selectedIds = []
          s.marquee = null
          s.pendingWire = null
          s.hoverPort = null
          s.pendingGroup = null
          s.pendingDelete = null
          if (issues.length > 0) {
            s.notice = `Removed ${issues.length} invalid reference(s) — see console`
          }
        })
        useEditorStore.temporal.getState().clear()
      } catch (e) {
        set((s) => void (s.notice = e instanceof Error ? e.message : 'Could not load file'))
      }
    },
    exportLibrary: () => {
      const s = get()
      downloadText('library.logica.json', serializeLibrary(buildLibraryFile(s.design)))
    },
    importLibrary: (json) => {
      try {
        const design = mergeLibrary(get().design, parseLibrary(json))
        set((s) => {
          s.design = design
        })
      } catch (e) {
        set((s) => void (s.notice = e instanceof Error ? e.message : 'Could not import library'))
      }
    },
    })),
    {
      limit: 100,
      partialize: (state) => ({ design: state.design }),
      equality: (past, current) => past.design === current.design,
      handleSet: (handleSet) => (pastState) => {
        // During a drag, record only the first change (its baseline), then skip the
        // rest until the drag ends.
        if (skipMoveRecording) return
        handleSet(pastState)
        skipMoveRecording = coalescingMove
      },
    },
  ),
)

/** The definition currently being viewed/edited (top of the navigation stack). */
export function currentDefId(state: EditorState): string {
  return state.navStack[state.navStack.length - 1]
}
