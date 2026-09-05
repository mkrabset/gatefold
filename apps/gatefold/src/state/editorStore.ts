import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { temporal } from 'zundo'
import type { ChildDef, CompositeDef, Design, Instance, PinRef, Port, PortDirection, PropertyValue } from '@gatefold/model'
import {
  allCompositeIds,
  allowInversion,
  allowRenameTerminals,
  applyGroup,
  arrayDirection,
  arrayPorts,
  builtinOf,
  captureClipboard,
  childLabel,
  childPorts,
  childPrimitive,
  cloneChildDef,
  cloneComposite,
  connectionError,
  defaultPropsOf,
  deleteTemplate,
  exportLibrary as buildLibraryFile,
  findComposite,
  findConnectionTo,
  forkOf,
  importLibrary as mergeLibrary,
  inferGroup,
  inputPorts,
  instantiateClipboard,
  isArityFixed,
  isArrayDef,
  isPortGroupDef,
  isPrimitiveKind,
  isTemplateDef,
  nextConnectionId,
  nextPortId,
  nextPrimitiveInputName,
  newUuid,
  outputPorts,
  parseLibrary,
  portGroupDirection,
  serializeDesign,
  serializeLibrary,
  templateNames,
  uniqueId,
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
 * `Design`, the navigation path into composites, the viewport, and the
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

/**
 * A navigation step: the root, a descent into a placed instance, or an open library
 * template. Resolved to the current def by walking from `design.root`.
 */
export type NavStep =
  | { kind: 'root' }
  | { kind: 'instance'; id: string }
  | { kind: 'template'; id: string }

/** Values captured in the group dialog while awaiting confirmation. */
export interface PendingGroup {
  name: string
  inputs: string[]
  outputs: string[]
  /** True when promoting a single custom component instance to a template. */
  promote: boolean
  /** The instance to promote (set when `promote` is true). */
  promoteInstanceId: string | null
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

/** Resolve the def currently being viewed/edited by walking the navigation path. */
export function resolveNav(design: Design, navStack: NavStep[]): ChildDef | undefined {
  let current: ChildDef = design.root
  for (let i = 1; i < navStack.length; i++) {
    const step = navStack[i]
    if (current.kind !== 'composite') return undefined
    if (step.kind === 'instance') {
      const inst: Instance | undefined = current.instances.find((x) => x.id === step.id)
      if (!inst) return undefined
      current = inst.def
    } else if (step.kind === 'template') {
      const tpl = design.library[step.id]
      if (!tpl) return undefined
      current = tpl
    } else {
      return undefined
    }
  }
  return current
}

/** The def currently being viewed/edited (top of the navigation stack). */
export function currentDef(state: EditorState): ChildDef {
  return resolveNav(state.design, state.navStack) ?? state.design.root
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
  navStack: NavStep[]
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
  navigateTo: (step: NavStep) => void
  navigateUp: () => void
  resetNavigation: () => void
  openGroupDialog: () => void
  setGroupName: (name: string) => void
  setGroupInputName: (index: number, name: string) => void
  setGroupOutputName: (index: number, name: string) => void
  confirmGroup: () => void
  cancelGroup: () => void
  requestDeleteTemplate: (defId: string) => void
  confirmDeleteTemplate: () => void
  cancelDeleteTemplate: () => void
  renamePort: (portId: string, name: string, instanceId?: string) => void
  setPortInverted: (portId: string, inverted: boolean, instanceId?: string) => void
  togglePinInversion: (ref: PinRef) => void
  renameInstance: (id: string, name: string) => void
  renameDef: (defId: string, name: string) => void
  setDefCategory: (defId: string, category: string) => void
  setInstanceProp: (id: string, name: string, value: PropertyValue) => void
  addPort: (direction: PortDirection, instanceId?: string) => void
  removePort: (portId: string, instanceId?: string) => void
  setPortOrder: (direction: PortDirection, ids: string[], instanceId?: string) => void
  addInstance: (kindOrId: string, pos: { x: number; y: number }) => void
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

/** Prune connections touching the given ports of `instanceId` from `parent`. */
function pruneInstancePorts(parent: CompositeDef, instanceId: string, portIds: Set<string>): void {
  parent.connections = parent.connections.filter(
    (c) =>
      !(c.from.instanceId === instanceId && portIds.has(c.from.portId)) &&
      !(c.to.instanceId === instanceId && portIds.has(c.to.portId)),
  )
}

/** Prune the parent sheet's wires to the current scope's removed ports (a no-op unless
 *  the scope is a live copy descended into via an instance). */
function pruneOwnerPorts(s: EditorState, portIds: Set<string>): void {
  const steps = s.navStack
  const last = steps[steps.length - 1]
  if (last.kind !== 'instance') return
  const parent = resolveNav(s.design, steps.slice(0, -1))
  if (!parent || parent.kind !== 'composite') return
  pruneInstancePorts(parent, last.id, portIds)
}

/** Set an array's terminal type, regenerating its ports and pruning all connections on change. */
function applyArrayTerminalType(parentDef: CompositeDef, inst: Instance, terminalType: 'wire' | 'bus'): void {
  const def = inst.def
  if (def.kind !== 'fork') return
  if (!inst.props) inst.props = {}
  const prevType: 'wire' | 'bus' = inst.props.terminalType === 'wire' ? 'wire' : 'bus'
  inst.props.terminalType = terminalType
  def.ports = arrayPorts(arrayDirection(def), terminalType, 1)
  if (terminalType !== prevType) {
    parentDef.connections = parentDef.connections.filter(
      (c) => c.from.instanceId !== inst.id && c.to.instanceId !== inst.id,
    )
  }
}

/** Replace an array's WIRE ports with `count` lanes, pruning connections to removed ports. */
function applyArrayPortCount(parentDef: CompositeDef, inst: Instance, count: number): void {
  const def = inst.def
  if (def.kind !== 'fork') return
  const newPorts = arrayPorts(arrayDirection(def), 'wire', count)
  const removed = new Set(def.ports.map((p) => p.id).filter((id) => !newPorts.some((p) => p.id === id)))
  def.ports = newPorts
  if (removed.size > 0) {
    parentDef.connections = parentDef.connections.filter(
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
function portPlacement(def: CompositeDef, direction: PortDirection): { x: number; y: number } {
  const insts = def.instances
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const inst of insts) {
    // Ignore existing port groups so placement is relative to real components only.
    if (isPortGroupDef(inst.def)) continue
    const b = instanceBounds(def, inst, inst.def)
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

/** An empty starting design: an empty root sheet (built-ins are inline references). */
export function createDemoDesign(): Design {
  return {
    version: 2,
    root: { kind: 'composite', id: 'main', name: 'main', uuid: newUuid(), ports: [], instances: [], connections: [] },
    library: {},
  }
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
      navStack: [{ kind: 'root' }],
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
          const def = currentDef(s)
          if (!def || def.kind !== 'composite') return
          ids.forEach((id, i) => {
            const inst = def.instances.find((x) => x.id === id)
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
      navigateTo: (step) =>
        set((s) => {
          // Remember the view we're leaving so Escape can restore it later.
          s.viewportStack[s.viewportStack.length - 1] = s.viewport
          s.navStack.push(step)
          s.viewportStack.push(s.viewport)
          s.selectedIds = []
          s.marquee = null
          s.pendingWire = null
          s.hoverPort = null
          // Request a fit-to-view of the newly-entered component.
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
      resetNavigation: () =>
        set((s) => {
          s.navStack = [{ kind: 'root' }]
          s.viewportStack = [s.viewport]
          s.selectedIds = []
          s.marquee = null
          s.pendingWire = null
          s.hoverPort = null
        }),
      openGroupDialog: () =>
        set((s) => {
          const def = currentDef(s)
          if (!def || def.kind !== 'composite') return

          // A single selected custom component is promoted to a template rather than
          // wrapped in a new layer of ports.
          if (s.selectedIds.length === 1) {
            const inst = def.instances.find((i) => i.id === s.selectedIds[0])
            if (inst && inst.def.kind === 'composite') {
              s.pendingGroup = {
                name: inst.def.name,
                inputs: [],
                outputs: [],
                promote: true,
                promoteInstanceId: inst.id,
              }
              return
            }
          }

          // Infer the ports from the current selection and seed default names for the
          // dialog; the actual transformation happens on `confirmGroup`. Port-group
          // instances are never grouped — ignore a selection with no real components.
          const movable = s.selectedIds.filter((id) => {
            const inst = def.instances.find((i) => i.id === id)
            return !!inst && !isPortGroupDef(inst.def)
          })
          if (movable.length === 0) return

          const g = inferGroup(def, s.selectedIds)
          s.pendingGroup = {
            name: 'component',
            inputs: g.inputs.map((x, i) => x.name || `in${i + 1}`),
            outputs: g.outputs.map((x, i) => x.name || `out${i + 1}`),
            promote: false,
            promoteInstanceId: null,
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
          const scope = currentDef(s)
          if (!scope || scope.kind !== 'composite') {
            s.pendingGroup = null
            return
          }

          // Promote a single custom component instance to a template: deep-copy the
          // instance's def into a fresh library template, leaving the instance untouched.
          if (p.promote && p.promoteInstanceId) {
            const inst = scope.instances.find((i) => i.id === p.promoteInstanceId)
            if (inst && inst.def.kind === 'composite') {
              const name = uniqueAgainst(templateNames(s.design), p.name.trim() || inst.def.name)
              const copy = cloneComposite(inst.def, allCompositeIds(s.design))
              copy.name = name
              copy.uuid = newUuid()
              // Templates keep clean (non-inverted) terminals.
              for (const port of copy.ports) delete port.inverted
              s.design.library[copy.id] = copy
            }
            s.pendingGroup = null
            return
          }

          const { name, inputs, outputs } = p
          // Capture inherited inversion before grouping: `applyGroup` produces clean
          // (non-inverted) template ports, so the inversion is applied to the instance
          // copy below instead.
          const inferred = inferGroup(scope, s.selectedIds)
          const inputInverted = inferred.inputs.map((g) => g.inverted === true)
          const outputInverted = inferred.outputs.map((g) => g.inverted === true)
          const inputPortIncluded = inferred.inputPortIncluded
          const outputPortIncluded = inferred.outputPortIncluded
          const parentId = scope.id
          s.design = applyGroup(s.design, parentId, s.selectedIds, inputs, outputs, name)
          s.pendingGroup = null
          const newParent = findComposite(s.design, parentId)
          if (!newParent) return
          const last = newParent.instances[newParent.instances.length - 1]
          if (last) {
            const template = last.def
            if (template.kind === 'composite') {
              // Place the template's port groups relative to its components *before*
              // copy-on-place, so the library template and every copy inherit correct
              // positions. A side whose parent port group was included in the selection
              // keeps its original position (already set by `applyGroup`).
              for (const inst of template.instances) {
                if (inst.def.kind === 'builtin' && inst.def.primitive === 'input-port' && !inputPortIncluded) inst.pos = portPlacement(template, 'input')
                else if (inst.def.kind === 'builtin' && inst.def.primitive === 'output-port' && !outputPortIncluded) inst.pos = portPlacement(template, 'output')
              }
              // Copy-on-place: the grouped instance gets its own copy, independent of the
              // library template.
              const copy = cloneComposite(template, allCompositeIds(s.design))
              last.def = copy
              // Carry the inherited inversion onto the instance copy's ports.
              for (const [i, inv] of inputInverted.entries()) {
                const port = inputPorts(copy.ports)[i]
                if (port && inv) port.inverted = true
              }
              for (const [i, inv] of outputInverted.entries()) {
                const port = outputPorts(copy.ports)[i]
                if (port && inv) port.inverted = true
              }
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
          if (id === s.design.root.id) return
          if (s.navStack.some((step) => step.kind === 'template' && step.id === id)) {
            s.notice = 'Exit the component before deleting it'
            return
          }
          if (!s.design.library[id]) return
          s.design = deleteTemplate(s.design, id)
        }),
      renamePort: (portId, name, instanceId) =>
        set((s) => {
          const scope = currentDef(s)
          const def = instanceId !== undefined
            ? scope && scope.kind === 'composite' ? scope.instances.find((i) => i.id === instanceId)?.def : undefined
            : scope
          if (!def || !allowRenameTerminals(def)) return
          const port = childPorts(def).find((p) => p.id === portId)
          if (port) port.name = name
        }),
      setPortInverted: (portId, inverted, instanceId) =>
        set((s) => {
          // Without an explicit instanceId this targets the current scope's own ports —
          // the input/output port groups — which are never invertable. Only a placed
          // instance's terminals (instanceId passed) may be inverted.
          if (instanceId === undefined) return
          const scope = currentDef(s)
          if (!scope || scope.kind !== 'composite') return
          const inst = scope.instances.find((i) => i.id === instanceId)
          if (!inst) return
          const def = inst.def
          if (def.kind === 'composite' && isTemplateDef(s.design, def)) return
          if (!allowInversion(def)) return
          const port = childPorts(def).find((p) => p.id === portId)
          if (!port) return
          if (inverted) port.inverted = true
          else delete port.inverted
        }),
      togglePinInversion: (ref) =>
        set((s) => {
          const def = currentDef(s)
          if (!def || def.kind !== 'composite') return
          const inst = def.instances.find((i) => i.id === ref.instanceId)
          if (!inst) return
          const instDef = inst.def
          // The current scope's own terminals (the input/output port groups) are never
          // invertable — inversion is external-only, applied to a placed instance.
          if (isPortGroupDef(instDef)) return
          if (instDef.kind === 'composite' && isTemplateDef(s.design, instDef)) return
          if (!allowInversion(instDef)) return
          const port = childPorts(instDef).find((p) => p.id === ref.portId)
          if (!port) return
          if (port.inverted) delete port.inverted
          else port.inverted = true
        }),
      renameInstance: (id, name) =>
        set((s) => {
          const def = currentDef(s)
          if (!def || def.kind !== 'composite') return
          const inst = def.instances.find((x) => x.id === id)
          if (inst) inst.name = name
        }),
      renameDef: (defId, name) =>
        set((s) => {
          const def = s.design.library[defId]
          // Only composite origin templates are renameable.
          if (!def || !isTemplateDef(s.design, def)) return
          const trimmed = name.trim()
          if (!trimmed) return
          // Collide only against other templates (names are display-only).
          if (trimmed !== def.name && templateNames(s.design).has(trimmed)) {
            s.notice = `A component named "${trimmed}" already exists`
            return
          }
          def.name = trimmed
        }),
      setDefCategory: (defId, category) =>
        set((s) => {
          const def = s.design.library[defId]
          // Only composite origin templates can be categorized (same rule as `renameDef`).
          if (!def || !isTemplateDef(s.design, def)) return
          const trimmed = category.trim()
          if (trimmed) def.category = trimmed
          else delete def.category
        }),
      setInstanceProp: (id, name, value) =>
        set((s) => {
          const def = currentDef(s)
          if (!def || def.kind !== 'composite') return
          const inst = def.instances.find((x) => x.id === id)
          if (!inst) return
          if (isArrayDef(inst.def) && name === 'terminalType') {
            applyArrayTerminalType(def, inst, value === 'wire' ? 'wire' : 'bus')
            return
          }
          if (!inst.props) inst.props = {}
          inst.props[name] = value
        }),
      addPort: (direction, instanceId) =>
        set((s) => {
          const scope = currentDef(s)
          if (!scope) return
          if (instanceId !== undefined) {
            if (scope.kind !== 'composite') return
            const inst = scope.instances.find((i) => i.id === instanceId)
            if (!inst) return
            const def = inst.def
            if (isArrayDef(def)) {
              if ((inst.props?.terminalType ?? 'bus') === 'wire') {
                const count = childPorts(def).length + 1
                if (count <= 32) applyArrayPortCount(scope, inst, count)
              }
              return
            }
            addPortToDef(def, direction)
            return
          }
          addPortToDef(scope, direction)
        }),
      removePort: (portId, instanceId) =>
        set((s) => {
          const scope = currentDef(s)
          if (!scope) return
          if (instanceId !== undefined) {
            if (scope.kind !== 'composite') return
            const inst = scope.instances.find((i) => i.id === instanceId)
            if (!inst) return
            const def = inst.def
            if (isArrayDef(def)) {
              if ((inst.props?.terminalType ?? 'bus') === 'wire') {
                const count = childPorts(def).length - 1
                if (count >= 1) applyArrayPortCount(scope, inst, count)
              }
              return
            }
            removePortFromDef(s, def, portId, inst.id)
            return
          }
          removePortFromDef(s, scope, portId, undefined)
        }),
      setPortOrder: (direction, ids, instanceId) =>
        set((s) => {
          const scope = currentDef(s)
          const def = instanceId !== undefined
            ? scope && scope.kind === 'composite' ? scope.instances.find((i) => i.id === instanceId)?.def : undefined
            : scope
          if (!def) return
          // Array terminals are index-ordered; reordering is meaningless.
          if (isArrayDef(def)) return
          const ports = childPorts(def)
          const byId = new Map(ports.map((p) => [p.id, p]))
          const ordered = ids.map((id) => byId.get(id)).filter((p): p is Port => !!p)
          const inputs = inputPorts(ports)
          const outputs = outputPorts(ports)
          const reordered = direction === 'input' ? [...ordered, ...outputs] : [...inputs, ...ordered]
          const mutable = mutablePorts(def)
          if (mutable) mutable.splice(0, mutable.length, ...reordered)
        }),
      addInstance: (kindOrId, pos) =>
        set((s) => {
          const def = currentDef(s)
          if (!def || def.kind !== 'composite') return
          const usedIds = allCompositeIds(s.design)
          let srcDef: ChildDef | undefined = s.design.library[kindOrId]
          if (!srcDef && isPrimitiveKind(kindOrId)) srcDef = kindOrId === 'join-point' ? builtinOf('join-point') : forkOf(kindOrId)
          if (!srcDef) return
          const kind = childPrimitive(srcDef)
          // Default instance name is empty, except for CLOCK/DFF which keep their label.
          const name = kind === 'clock' || kind === 'dff' ? childLabel(srcDef) : ''
          const id = uniqueAgainst(new Set(def.instances.map((i) => i.id)), childLabel(srcDef))
          // Deep copy-on-place: the instance gets its own copy def, independent of the
          // library template.
          const copied = cloneChildDef(srcDef, usedIds)
          const props = kind ? defaultPropsOf(kind) : {}
          def.instances.push({ id, name, def: copied, pos: { x: pos.x, y: pos.y }, ...(Object.keys(props).length ? { props } : {}) })
          s.selectedIds = [id]
        }),
      addConnection: (from, to) =>
        set((s) => {
          const def = currentDef(s)
          if (!def || def.kind !== 'composite') return
          // Enforce the single-driver invariant: reject if the target is already driven.
          if (findConnectionTo(def.connections, to)) {
            s.notice = 'Input already has a driver'
            return
          }
          // Width must be consistent (and splitters require even buses).
          const err = connectionError(def, from, to)
          if (err) {
            s.notice = err
            return
          }
          def.connections.push({ id: nextConnectionId(def.connections), from, to })
        }),
      insertJoinPointAt: (connectionId, pos) =>
        set((s) => {
          const def = currentDef(s)
          if (!def || def.kind !== 'composite') return
          const conns = def.connections
          const conn = conns.find((c) => c.id === connectionId)
          if (!conn) return
          // Add the join-point, then re-route the original wire through it.
          const id = uniqueAgainst(new Set(def.instances.map((i) => i.id)), 'join-point')
          def.instances.push({ id, name: '', def: builtinOf('join-point'), pos: { x: pos.x, y: pos.y } })
          def.connections = conns.filter((c) => c.id !== connectionId)
          def.connections.push({ id: nextConnectionId(def.connections), from: conn.from, to: { instanceId: id, portId: 'in:0' } })
          def.connections.push({ id: nextConnectionId(def.connections), from: { instanceId: id, portId: 'out:0' }, to: conn.to })
          s.selectedIds = [id]
        }),
      retargetConnection: (id, to) =>
        set((s) => {
          const def = currentDef(s)
          if (!def || def.kind !== 'composite') return
          const conns = def.connections
          const original = conns.find((c) => c.id === id)
          if (!original) return
          const conflict = findConnectionTo(conns, to)
          if (conflict && conflict.id !== id) {
            s.notice = 'Input already has a driver'
            return
          }
          const err = connectionError(def, original.from, to)
          if (err) {
            s.notice = err
            return
          }
          original.to = to
        }),
      removeConnection: (id) =>
        set((s) => {
          const def = currentDef(s)
          if (!def || def.kind !== 'composite') return
          def.connections = def.connections.filter((c) => c.id !== id)
        }),
      deleteSelection: () =>
        set((s) => {
          const def = currentDef(s)
          if (!def || def.kind !== 'composite') return
          const deleted = new Set<string>()
          const removedPorts = new Set<string>()
          for (const id of s.selectedIds) {
            const inst = def.instances.find((i) => i.id === id)
            if (!inst) continue
            if (isPortGroupDef(inst.def)) {
              // Deleting a port group resets that side's terminal count to zero.
              const direction = portGroupDirection(inst.def)
              for (const p of def.ports) {
                if (p.direction === direction) removedPorts.add(p.id)
              }
            }
            deleted.add(id)
          }
          if (removedPorts.size > 0) {
            def.ports = def.ports.filter((p) => !removedPorts.has(p.id))
          }
          def.instances = def.instances.filter((i) => !deleted.has(i.id))
          def.connections = def.connections.filter(
            (c) => !deleted.has(c.from.instanceId) && !deleted.has(c.to.instanceId),
          )
          if (removedPorts.size > 0) {
            pruneOwnerPorts(s, removedPorts)
          }
          s.selectedIds = []
        }),
      copySelection: () => {
        const s = get()
        const def = currentDef(s)
        if (!def || def.kind !== 'composite') return
        const clip = captureClipboard(def, s.selectedIds)
        if (clip) {
          clipboard = clip
          pasteOffset = 0
        }
      },
      paste: () =>
        set((s) => {
          if (!clipboard) return
          pasteOffset += 24
          const def = currentDef(s)
          if (!def || def.kind !== 'composite') return
          const newIds = instantiateClipboard(def, clipboard, allCompositeIds(s.design), {
            x: pasteOffset,
            y: pasteOffset,
          })
          s.selectedIds = newIds
        }),
      applyTemplateToInstances: (templateId) =>
        set((s) => {
          const def = currentDef(s)
          if (!def || def.kind !== 'composite') return
          const scope = scopeDefIds(def)
          const { design, updated } = applyTemplate(s.design, templateId, scope)
          s.design = design
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
            s.navStack = [{ kind: 'root' }]
            s.viewportStack = [s.viewport]
            s.selectedIds = []
            s.marquee = null
            s.pendingWire = null
            s.hoverPort = null
            s.pendingGroup = null
            s.pendingDelete = null
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

/** The mutable ports array of a child def, or null when ports are derived (a built-in). */
function mutablePorts(def: ChildDef): Port[] | null {
  if (def.kind === 'composite' || def.kind === 'fork') return def.ports
  return null
}

/** Add a port to `def` (a fork or the current composite), backing composites with a port-group pin. */
function addPortToDef(def: ChildDef, direction: PortDirection): void {
  if (isArityFixed(def, direction)) return
  const ports = mutablePorts(def)
  if (!ports) return
  const count = direction === 'input' ? inputPorts(ports).length : outputPorts(ports).length
  const portId = nextPortId(ports, direction)
  const name = direction === 'input' ? nextPrimitiveInputName(def) ?? `in${count + 1}` : `out${count + 1}`
  let terminal: Port['terminal']
  if (def.kind === 'composite') {
    const groupKind = direction === 'input' ? 'input-port' : 'output-port'
    let group = def.instances.find((i) => i.def.kind === 'builtin' && i.def.primitive === groupKind)
    if (!group) {
      group = {
        id: uniqueAgainst(new Set(def.instances.map((i) => i.id)), direction === 'input' ? 'port-in' : 'port-out'),
        name: '',
        def: { kind: 'builtin', primitive: groupKind },
        pos: portPlacement(def, direction),
      }
      def.instances.push(group)
    }
    terminal = { instanceId: group.id, pinId: portId }
  }
  const port: Port = { id: portId, name, direction, terminal }
  if (direction === 'input') {
    const outStart = ports.findIndex((p) => p.direction === 'output')
    if (outStart === -1) ports.push(port)
    else ports.splice(outStart, 0, port)
  } else {
    ports.push(port)
  }
}

/** Remove a port from `def`, pruning the owning sheet's wires to the removed terminal. */
function removePortFromDef(s: EditorState, def: ChildDef, portId: string, instanceId: string | undefined): void {
  const ports = mutablePorts(def)
  if (!ports) return
  const port = ports.find((p) => p.id === portId)
  if (port && isArityFixed(def, port.direction)) return
  const filtered = ports.filter((p) => p.id !== portId)
  ports.splice(0, ports.length, ...filtered)
  // Prune wires to the removed terminal.
  if (instanceId !== undefined) {
    const scope = currentDef(s)
    if (scope && scope.kind === 'composite') pruneInstancePorts(scope, instanceId, new Set([portId]))
  } else {
    pruneOwnerPorts(s, new Set([portId]))
  }
  if (def.kind !== 'composite') return
  const instId = port?.terminal?.instanceId
  if (instId) {
    // Drop any connections touching this port's group pin.
    def.connections = def.connections.filter(
      (c) =>
        !(c.from.instanceId === instId && c.from.portId === portId) &&
        !(c.to.instanceId === instId && c.to.portId === portId),
    )
    // If no ports of that direction remain, remove the group instance.
    const remaining = port?.direction === 'input' ? inputPorts(ports).length : outputPorts(ports).length
    if (remaining === 0) {
      def.instances = def.instances.filter((i) => i.id !== instId)
    }
  }
}
