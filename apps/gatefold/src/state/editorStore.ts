import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { temporal } from 'zundo'
import type { ComponentDef, Design, Instance, PinRef, Port, PortDirection } from '@gatefold/model'
import {
  allowInversion,
  allowRenameTerminals,
  applyGroup,
  arrayPorts,
  captureClipboard,
  connectionError,
  copyDefSubgraph,
  defaultPropsOf,
  exportLibrary as buildLibraryFile,
  findConnectionTo,
  importLibrary as mergeLibrary,
  inferGroup,
  inputPortDef,
  inputPorts,
  instantiateClipboard,
  instancesReferencing,
  isArityFixed,
  isDefReferenced,
  isPortGroupDef,
  isTemplateDef,
  libraryPrimitives,
  nextPortId,
  nextPrimitiveInputName,
  newUuid,
  outputPortDef,
  outputPorts,
  parseLibrary,
  portGroupDirection,
  primitiveDef,
  serializeDesign,
  serializeLibrary,
  uniqueId,
  unreachableDefIds,
} from '@gatefold/model'
import type { Clipboard } from '@gatefold/model'
import { exportVerilog as buildVerilog } from '@gatefold/verilog'
import { instanceBounds } from '../editor/geometry'
import { applyTemplate, scopeDefIds } from '../editor/apply'
import { downloadText } from '../util/download'
import { encodeDesignLink } from '../util/link'
import { clearDefaultState, readDefaultState, repairDesign, saveDefaultState } from './defaultState'

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

/** An imaginary cut line (Ctrl/Cmd+drag) used to slice a wire with a new NODE. */
export interface CutLine {
  start: { x: number; y: number }
  end: { x: number; y: number }
}

interface EditorState {
  viewport: Viewport
  /** Saved viewport per nav-stack depth (parallel to `navStack`), for restore on escape. */
  viewportStack: Viewport[]
  selectedIds: string[]
  marquee: Rect | null
  pendingWire: PendingWire | null
  cutLine: CutLine | null
  hoverPort: PinRef | null
  notice: string | null
  navStack: string[]
  design: Design
  /** Incremented on design load / descent to request a one-shot fit-to-view from the canvas. */
  fitToken: number
  pendingGroup: PendingGroup | null
  pendingDelete: string | null
  setViewport: (viewport: Viewport) => void
  setSelection: (ids: string[]) => void
  toggleSelected: (id: string) => void
  setInstancesPosition: (ids: string[], positions: { x: number; y: number }[]) => void
  setMarquee: (rect: Rect | null) => void
  setPendingWire: (wire: PendingWire | null) => void
  setCutLine: (line: CutLine | null) => void
  setHoverPort: (hover: PinRef | null) => void
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
  renamePort: (portId: string, name: string, defId?: string) => void
  setPortInverted: (portId: string, inverted: boolean, defId?: string) => void
  togglePinInversion: (ref: PinRef) => void
  renameInstance: (id: string, name: string) => void
  renameDef: (defId: string, name: string) => void
  setInstanceProp: (id: string, name: string, value: unknown) => void
  addPort: (direction: PortDirection, defId?: string) => void
  removePort: (portId: string, defId?: string) => void
  setPortOrder: (direction: PortDirection, ids: string[], defId?: string) => void
  addInstance: (defId: string, pos: { x: number; y: number }) => void
  addConnection: (from: PinRef, to: PinRef) => void
  insertJoinPointAt: (connectionId: string, pos: { x: number; y: number }) => void
  retargetConnection: (id: string, to: PinRef) => void
  removeConnection: (id: string) => void
  deleteSelection: () => void
  copySelection: () => void
  paste: () => void
  applyTemplateToInstances: (templateId: string) => void
  saveProject: () => void
  loadProject: (json: string) => void
  saveDefault: () => void
  clearDefault: () => void
  copyLink: () => Promise<void>
  exportLibrary: () => void
  importLibrary: (json: string) => void
  exportVerilog: () => void
}

/** True for the switch-array/led-array primitives. */
const isArrayPrimitive = (def?: ComponentDef): boolean =>
  !!def && def.kind === 'primitive' && (def.primitive === 'switch-array' || def.primitive === 'led-array')

/** Terminal direction of an array primitive. */
const arrayDirection = (def: ComponentDef): PortDirection =>
  def.primitive === 'switch-array' ? 'output' : 'input'

/**
 * Deep-copy `defId` and its transitive closure into the design as fresh variants and
 * return the new top-level def id (copy-on-place). Mutates `design.defs` in place
 * (operates on an immer draft).
 */
function copyDefIntoDesign(design: Design, defId: string): string {
  const usedIds = new Set(Object.keys(design.defs))
  const { defs, idMap } = copyDefSubgraph(design.defs, [defId], usedIds)
  for (const [copyId, d] of Object.entries(defs)) design.defs[copyId] = d
  return idMap.get(defId) ?? defId
}

/** Find the single instance referencing an array's (variant) def, and its parent. */
function findArrayRef(design: Design, defId: string): { parent: ComponentDef; inst: Instance } | null {
  const ref = instancesReferencing(design, defId)[0]
  return ref ? { parent: ref.def, inst: ref.instance } : null
}

/** Prune connections to the given ports of `defId` from every sheet that references it. */
function pruneConnectionsToPorts(design: Design, defId: string, portIds: Set<string>): void {
  for (const { def: parent, instance: inst } of instancesReferencing(design, defId)) {
    parent.connections = (parent.connections ?? []).filter(
      (c) =>
        !(c.from.instanceId === inst.id && portIds.has(c.from.portId)) &&
        !(c.to.instanceId === inst.id && portIds.has(c.to.portId)),
    )
  }
}

/** Remove orphaned defs (variant copies no longer reachable from any kept def). */
function pruneOrphanedDefs(design: Design): void {
  for (const id of unreachableDefIds(design)) delete design.defs[id]
}

/** Set an array's terminal type, regenerating its ports and pruning all connections on change. */
function applyArrayTerminalType(parentDef: ComponentDef, inst: Instance, instDef: ComponentDef, terminalType: 'wire' | 'bus'): void {
  if (!inst.props) inst.props = {}
  const prevType = (inst.props.terminalType ?? 'bus') as 'wire' | 'bus'
  inst.props.terminalType = terminalType
  instDef.ports = arrayPorts(arrayDirection(instDef), terminalType, 1)
  if (terminalType !== prevType) {
    // Switching WIRE ↔ BUS invalidates every connection to this instance.
    parentDef.connections = (parentDef.connections ?? []).filter(
      (c) => c.from.instanceId !== inst.id && c.to.instanceId !== inst.id,
    )
  }
}

/** Replace an array's WIRE ports with `count` lanes, pruning connections to removed ports. */
function applyArrayPortCount(parentDef: ComponentDef, inst: Instance, instDef: ComponentDef, count: number): void {
  const newPorts = arrayPorts(arrayDirection(instDef), 'wire', count)
  const removed = new Set(instDef.ports.map((p) => p.id).filter((id) => !newPorts.some((p) => p.id === id)))
  instDef.ports = newPorts
  if (removed.size > 0) {
    parentDef.connections = (parentDef.connections ?? []).filter(
      (c) => !(c.from.instanceId === inst.id && removed.has(c.from.portId)) && !(c.to.instanceId === inst.id && removed.has(c.to.portId)),
    )
  }
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

/** An empty starting design: all built-in primitives and an empty root sheet. */
export function createDemoDesign(): Design {
  const defs: Record<string, ComponentDef> = {}
  for (const spec of libraryPrimitives()) {
    defs[spec.kind] = primitiveDef(spec.kind)
  }
  defs['input-port'] = inputPortDef()
  defs['output-port'] = outputPortDef()

  defs['main'] = {
    id: 'main',
    name: 'main',
    kind: 'composite',
    uuid: newUuid(),
    ports: [],
    instances: [],
    connections: [],
  }

  return { version: 1, root: 'main', defs }
}

/** The design restored from localStorage on launch, or null when none is stored. */
const initialDesign = readDefaultState()

export const useEditorStore = create<EditorState>()(
  temporal(
    immer((set, get) => ({
      viewport: { x: 400, y: 250, zoom: 1 },
      viewportStack: [{ x: 400, y: 250, zoom: 1 }],
      selectedIds: [],
      marquee: null,
    pendingWire: null,
    cutLine: null,
    hoverPort: null,
    notice: null,
    navStack: ['main'],
    design: initialDesign ?? createDemoDesign(),
    fitToken: initialDesign ? 1 : 0,
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
    setCutLine: (line) => set((s) => void (s.cutLine = line)),
    setHoverPort: (hover) => set((s) => void (s.hoverPort = hover)),
    setNotice: (message) => set((s) => void (s.notice = message)),
    clearNotice: () => set((s) => void (s.notice = null)),
    navigateTo: (defId) =>
      set((s) => {
        // Remember the view we're leaving so Escape can restore it later.
        s.viewportStack[s.viewportStack.length - 1] = s.viewport
        s.navStack.push(defId)
        s.viewportStack.push(s.viewport)
        s.selectedIds = []
        s.marquee = null
        s.pendingWire = null
        s.hoverPort = null
        // Request a fit-to-view of the newly-entered component (canvas, library, or
        // sidebar descent alike).
        s.fitToken += 1
      }),
    navigateUp: () =>
      set((s) => {
        if (s.navStack.length > 1) {
          s.navStack.pop()
          s.viewportStack.pop()
          s.viewport = s.viewportStack[s.viewportStack.length - 1]
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
            const top = s.design.defs[copyDefIntoDesign(s.design, p.promoteDefId)]
            top.name = name
            top.variant = false
            top.uuid = newUuid()
            // Templates keep clean (non-inverted) terminals.
            for (const port of top.ports) delete port.inverted
          }
          s.pendingGroup = null
          return
        }

        const defId = currentDefId(s)
        const { name, inputs, outputs } = p
        // Capture inherited inversion before grouping: `applyGroup` now produces clean
        // (non-inverted) template ports, so the inversion is applied to the instance
        // variant below instead.
        const inferred = inferGroup(s.design, defId, s.selectedIds)
        const inputInverted = inferred.inputs.map((g) => g.inverted === true)
        const outputInverted = inferred.outputs.map((g) => g.inverted === true)
        const inputPortIncluded = inferred.inputPortIncluded
        const outputPortIncluded = inferred.outputPortIncluded
        // applyGroup returns a fresh design (pure); assign it wholesale and select
        // the newly created instance, which is appended last in the parent.
        s.design = applyGroup(s.design, defId, s.selectedIds, inputs, outputs, name)
        s.pendingGroup = null
        const def = s.design.defs[defId]
        const last = def.instances?.[def.instances.length - 1]
        if (last) {
          // Place the template's port groups relative to its components *before*
          // copy-on-place, so the library template and every copy inherit correct
          // positions. A side whose parent port group was included in the selection
          // keeps its original position (already set by `applyGroup`); other sides are
          // auto-placed (inputs left of the leftmost pin, outputs right of the rightmost).
          const template = s.design.defs[last.defId]
          for (const inst of template.instances ?? []) {
            if (inst.defId === 'input-port' && !inputPortIncluded) inst.pos = portPlacement(template, s.design, 'input')
            else if (inst.defId === 'output-port' && !outputPortIncluded) inst.pos = portPlacement(template, s.design, 'output')
          }
          // Copy-on-place: deep-copy the template and its whole hierarchy into fresh
          // variants so the grouped instance is fully independent of the library template.
          const newDefId = copyDefIntoDesign(s.design, last.defId)
          last.defId = newDefId
          const newDef = s.design.defs[newDefId]
          // Carry the inherited inversion onto the instance variant's ports.
          for (const [i, inv] of inputInverted.entries()) {
            const port = inputPorts(newDef)[i]
            if (port && inv) port.inverted = true
          }
          for (const [i, inv] of outputInverted.entries()) {
            const port = outputPorts(newDef)[i]
            if (port && inv) port.inverted = true
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
        pruneOrphanedDefs(s.design)
      }),
    renamePort: (portId, name, defId) =>
      set((s) => {
        const def = s.design.defs[defId ?? currentDefId(s)]
        if (!allowRenameTerminals(def)) return
        const port = def.ports.find((p) => p.id === portId)
        if (port) port.name = name
      }),
    setPortInverted: (portId, inverted, defId) =>
      set((s) => {
        const def = s.design.defs[defId ?? currentDefId(s)]
        if (isTemplateDef(s.design, def)) return
        if (!allowInversion(def)) return
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
        if (isTemplateDef(s.design, ownerDef)) return
        if (!allowInversion(ownerDef)) return
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
        if (!def || !isTemplateDef(s.design, def)) return
        const trimmed = name.trim()
        if (!trimmed) return
        // Reject a name already used by any def (template, variant, built-in, or root).
        for (const [id, other] of Object.entries(s.design.defs)) {
          if (id !== defId && other.name === trimmed) {
            s.notice = `A component named "${trimmed}" already exists`
            return
          }
        }
        def.name = trimmed
      }),
    setInstanceProp: (id, name, value) =>
      set((s) => {
        const def = s.design.defs[currentDefId(s)]
        const inst = def.instances?.find((x) => x.id === id)
        if (!inst) return
        const instDef = s.design.defs[inst.defId]
        if (isArrayPrimitive(instDef) && name === 'terminalType') {
          applyArrayTerminalType(def, inst, instDef, value as 'wire' | 'bus')
          return
        }
        if (!inst.props) inst.props = {}
        inst.props[name] = value
      }),
    addPort: (direction, defId) =>
      set((s) => {
        const def = s.design.defs[defId ?? currentDefId(s)]
        if (isArrayPrimitive(def)) {
          const ref = findArrayRef(s.design, def.id)
          if (ref && (ref.inst.props?.terminalType ?? 'bus') === 'wire') {
            const count = def.ports.length + 1
            if (count <= 32) applyArrayPortCount(ref.parent, ref.inst, def, count)
          }
          return
        }
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
    removePort: (portId, defId) =>
      set((s) => {
        const def = s.design.defs[defId ?? currentDefId(s)]
        if (isArrayPrimitive(def)) {
          const ref = findArrayRef(s.design, def.id)
          if (ref && (ref.inst.props?.terminalType ?? 'bus') === 'wire') {
            const count = def.ports.length - 1
            if (count >= 1) applyArrayPortCount(ref.parent, ref.inst, def, count)
          }
          return
        }
        const port = def.ports.find((p) => p.id === portId)
        if (port && isArityFixed(def, port.direction)) return
        def.ports = def.ports.filter((p) => p.id !== portId)
        // Prune any parent sheet's wires to the removed terminal.
        pruneConnectionsToPorts(s.design, def.id, new Set([portId]))
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
    setPortOrder: (direction, ids, defId) =>
      set((s) => {
        const def = s.design.defs[defId ?? currentDefId(s)]
        // Array terminals are index-ordered; reordering is meaningless.
        if (isArrayPrimitive(def)) return
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
        const name = srcDef.name
        const id = uniqueAgainst(new Set(def.instances.map((i) => i.id)), name)
        // Deep copy-on-place: the instance gets its own variant def *and* a copy of
        // its whole internal hierarchy, independent of the library template.
        const newDefId = copyDefIntoDesign(s.design, defId)
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
    insertJoinPointAt: (connectionId, pos) =>
      set((s) => {
        const def = s.design.defs[currentDefId(s)]
        const conns = def.connections ?? []
        const conn = conns.find((c) => c.id === connectionId)
        if (!conn) return
        const srcDef = s.design.defs['join-point']
        if (!srcDef) return
        if (!def.instances) def.instances = []
        // Add the join-point (copy-on-place), then re-route the original wire through it.
        const id = uniqueAgainst(new Set(def.instances.map((i) => i.id)), srcDef.name)
        const newDefId = copyDefIntoDesign(s.design, 'join-point')
        def.instances.push({ id, name: srcDef.name, defId: newDefId, pos: { x: pos.x, y: pos.y } })
        def.connections = conns.filter((c) => c.id !== connectionId)
        const nextConnId = () => {
          const ids = new Set(def.connections!.map((c) => c.id))
          let n = def.connections!.length + 1
          while (ids.has(`c${n}`)) n++
          return `c${n}`
        }
        def.connections.push({ id: nextConnId(), from: conn.from, to: { instanceId: id, portId: 'in:0' } })
        def.connections.push({ id: nextConnId(), from: { instanceId: id, portId: 'out:0' }, to: conn.to })
        s.selectedIds = [id]
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
        const removedPorts = new Set<string>()
        for (const id of s.selectedIds) {
          const inst = def.instances?.find((i) => i.id === id)
          if (!inst) continue
          const instDef = s.design.defs[inst.defId]
          if (!instDef) continue
          if (isPortGroupDef(instDef)) {
            // Deleting a port group resets that side's terminal count to zero.
            const direction = portGroupDirection(instDef)
            for (const p of def.ports) {
              if (p.direction === direction) removedPorts.add(p.id)
            }
          }
          deleted.add(id)
        }
        if (removedPorts.size > 0) {
          def.ports = def.ports.filter((p) => !removedPorts.has(p.id))
        }
        def.instances = (def.instances ?? []).filter((i) => !deleted.has(i.id))
        def.connections = (def.connections ?? []).filter(
          (c) => !deleted.has(c.from.instanceId) && !deleted.has(c.to.instanceId),
        )
        if (removedPorts.size > 0) {
          pruneConnectionsToPorts(s.design, def.id, removedPorts)
        }
        pruneOrphanedDefs(s.design)
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
    applyTemplateToInstances: (templateId) =>
      set((s) => {
        const scope = scopeDefIds(s.design, currentDefId(s))
        const { design, updated } = applyTemplate(s.design, templateId, scope)
        s.design = design
        pruneOrphanedDefs(s.design)
        s.notice = updated > 0 ? `Applied to ${updated} instance(s)` : 'No matching instances'
      }),
    saveProject: () => {
      const s = get()
      downloadText('design.gatefold.json', serializeDesign(s.design))
    },
    loadProject: (json) => {
      try {
        const { design, issues } = repairDesign(json)
        if (issues.length > 0) {
          console.warn('Design repaired on load:', issues)
        }
        set((s) => {
          s.design = design
          s.navStack = [design.root]
          s.viewportStack = [s.viewport]
          s.selectedIds = []
          s.marquee = null
          s.pendingWire = null
          s.hoverPort = null
          s.pendingGroup = null
          s.pendingDelete = null
          pruneOrphanedDefs(s.design)
          s.fitToken += 1
          if (issues.length > 0) {
            s.notice = `Removed ${issues.length} invalid reference(s) — see console`
          }
        })
        useEditorStore.temporal.getState().clear()
      } catch (e) {
        set((s) => void (s.notice = e instanceof Error ? e.message : 'Could not load file'))
      }
    },
    saveDefault: () => {
      const s = get()
      if (saveDefaultState(s.design)) set((st) => void (st.notice = 'Default state saved'))
      else set((st) => void (st.notice = 'Could not save default state'))
    },
    clearDefault: () => {
      if (clearDefaultState()) set((st) => void (st.notice = 'Default state cleared'))
      else set((st) => void (st.notice = 'Could not clear default state'))
    },
    copyLink: async () => {
      try {
        const url = await encodeDesignLink(get().design)
        await navigator.clipboard.writeText(url)
        set((st) => void (st.notice = 'Link copied'))
      } catch {
        set((st) => void (st.notice = 'Could not copy link'))
      }
    },
    exportLibrary: () => {
      const s = get()
      downloadText('library.gatefold.json', serializeLibrary(buildLibraryFile(s.design)))
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
    exportVerilog: () => {
      try {
        const { source, issues } = buildVerilog(serializeDesign(get().design))
        downloadText('design.v', source)
        const errors = issues.filter((i) => i.level === 'error')
        const infos = issues.filter((i) => i.level === 'info')
        for (const i of infos) console.info(`Verilog export: ${i.message}`)
        for (const e of errors) console.error(`Verilog export error: ${e.message}`)
        if (errors.length > 0) {
          set((s) => void (s.notice = `Exported Verilog with ${errors.length} error(s) — see console`))
        }
      } catch (e) {
        set((s) => void (s.notice = e instanceof Error ? e.message : 'Could not export Verilog'))
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
