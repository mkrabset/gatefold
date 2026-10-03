import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { temporal } from 'zundo'
import type { ChildDef, CompositeDef, Design, Instance, PinRef, Port, PortDirection, PrimitiveKind, PropertyValue, PullDirection, Testbench, ArrayChain, ArrayOrientation } from '@gatefold/model'
import {
  allCompositeIds,
  allowInversion,
  allowRenameTerminals,
  applyGroup,
  arrayComposite,
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
  emptyTestbench,
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
  isProbeDef,
  isTemplateDef,
  MAIN_INSTANCE_ID,
  nextConnectionId,
  newUuid,
  outputPorts,
  parseLibrary,
  portGroupDirection,
  serializeDesign,
  serializeLibrary,
  templateCategory,
  templateNames,
  testbenchComposite,
  uniqueId,
} from '@gatefold/model'
import type { Clipboard } from '@gatefold/model'
import { exportVerilog as buildVerilog } from '@gatefold/verilog'
import { applyTemplate, applyTemplateToAll, scopeDefIds } from '../editor/apply'
import { computeAutoConnectMatches } from '../editor/autoconnect'
import { addPortToDef, applyArrayPortCount, applyArrayTerminalType, applyCounterPorts, applyCounterTerminalType, applyRegisterPorts, applyRegisterTerminalType, applyRomAccess, mutablePorts, portPlacement, pruneInstancePorts } from '../editor/portEdit'
import type { CutLine, PendingWire, Rect, Viewport } from '../editor/types'
import { downloadText } from '../util/download'
import { encodeDesignLink } from '../util/link'
import { clearDefaultState, readDefaultState, repairDesign, saveDefaultState } from './defaultState'

/**
 * The document and editing state, in one Zustand store (with immer for ergonomic
 * mutation of the nested design, and zundo for undo/redo over the design). Holds the
 * `Design`, the navigation path into composites, the viewport, and the
 * selection/marquee.
 */

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

/** Values captured in the array dialog while awaiting confirmation. */
export interface PendingArray {
  /** The selected composite instance being wrapped. */
  instanceId: string
  count: number
  chains: ArrayChain[]
  orientation: ArrayOrientation
  /** Input port ids delivered as one shared wire to every copy (not a bus). */
  common: string[]
  /** Wrap the selected instance in a *new* array layer (instead of editing it in place). */
  newLayer: boolean
}

/** The deletion scope chosen in the "clear everything" dialog. */
export interface ClearAllSelection {
  /** Clear the root sheet's instances/connections/ports. */
  tree: boolean
  /** Library template ids to delete (resolved by the dialog from the chosen categories). */
  templateIds: string[]
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

/**
 * The composite to resolve bus widths against: the edited library template when one is
 * open (a template has no external context), otherwise the design root — so a nested
 * component's external bus connections still determine its internal widths.
 */
export function currentWidthRoot(state: EditorState): CompositeDef {
  const tpl = state.navStack.find((s) => s.kind === 'template')
  return tpl ? state.design.library[tpl.id] : state.design.root
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
  pendingArray: PendingArray | null
  pendingDelete: string | null
  /** True while the "delete everything" confirmation dialog is open. */
  pendingClearAll: boolean
  /** True while the "delete library categories" confirmation dialog is open. */
  pendingCategoryDelete: boolean
  /** The ROM whose memory contents are being edited, or null when the dialog is closed. */
  romDialog: { instanceId: string } | null
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
  openArrayDialog: () => void
  setArrayDialogCount: (count: number) => void
  setArrayDialogChains: (chains: ArrayChain[]) => void
  setArrayDialogOrientation: (orientation: ArrayOrientation) => void
  setArrayDialogCommon: (common: string[]) => void
  setArrayDialogNewLayer: (newLayer: boolean) => void
  confirmArray: () => void
  cancelArray: () => void
  setArrayCount: (instanceId: string, count: number) => void
  setArrayChains: (instanceId: string, chains: ArrayChain[]) => void
  setArrayOrientation: (instanceId: string, orientation: ArrayOrientation) => void
  requestDeleteTemplate: (defId: string) => void
  confirmDeleteTemplate: () => void
  cancelDeleteTemplate: () => void
  requestClearAll: () => void
  confirmClearAll: (selection: ClearAllSelection) => void
  cancelClearAll: () => void
  requestCategoryDelete: () => void
  confirmCategoryDelete: (categoryNames: string[]) => void
  cancelCategoryDelete: () => void
  openRomDialog: (instanceId: string) => void
  closeRomDialog: () => void
  renamePort: (portId: string, name: string, instanceId?: string) => void
  setPortInverted: (portId: string, inverted: boolean, instanceId?: string) => void
  togglePinInversion: (ref: PinRef) => void
  togglePinPull: (ref: PinRef, pull: PullDirection) => void
  renameInstance: (id: string, name: string) => void
  renameDef: (defId: string, name: string) => void
  setDefCategory: (defId: string, category: string) => void
  setInstanceProp: (id: string, name: string, value: PropertyValue) => void
  addPort: (direction: PortDirection, instanceId?: string) => void
  removePort: (portId: string, instanceId?: string) => void
  setPortOrder: (direction: PortDirection, ids: string[], instanceId?: string) => void
  addInstance: (kindOrId: string, pos: { x: number; y: number }) => void
  addConnection: (from: PinRef, to: PinRef) => void
  connectAutoMatches: () => void
  insertJoinPointAt: (connectionId: string, pos: { x: number; y: number }) => void
  retargetConnection: (id: string, to: PinRef) => void
  removeConnection: (id: string) => void
  removeConnections: (ids: string[]) => void
  deleteSelection: () => void
  copySelection: () => void
  paste: () => void
  applyTemplateToInstances: (templateId: string) => void
  applyTemplateToAll: (templateId: string) => void
  saveProject: () => void
  loadProject: (json: string) => void
  saveDefault: () => void
  clearDefault: () => void
  copyLink: () => Promise<void>
  exportLibrary: () => void
  importLibrary: (json: string) => void
  exportVerilog: () => void
  addTestInstance: (kind: string, pos: { x: number; y: number }) => void
  setMainPos: (pos: { x: number; y: number }) => void
  setTestInstancesPosition: (ids: string[], positions: { x: number; y: number }[]) => void
  setTestInstanceProp: (id: string, name: string, value: PropertyValue) => void
  addTestConnection: (from: PinRef, to: PinRef) => void
  retargetTestConnection: (id: string, to: PinRef) => void
  removeTestConnection: (id: string) => void
  deleteTestInstances: (ids: string[]) => void
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

/** Reset the transient editing state after a bulk structural delete (shared by the
 *  clear-everything and delete-categories flows). */
function resetAfterBulkDelete(s: EditorState): void {
  s.navStack = [{ kind: 'root' }]
  s.viewportStack = [s.viewport]
  s.selectedIds = []
  s.marquee = null
  s.pendingWire = null
  s.hoverPort = null
  s.pendingGroup = null
  s.pendingArray = null
  s.pendingDelete = null
  s.fitToken += 1
}

/**
 * The library template to array from: the origin of `def`'s lineage when one exists,
 * else a freshly promoted template (deep-copied, clean terminals, new uuid). Promoting
 * keeps the array's copies reachable by "apply template changes to all" later.
 */
function resolveArrayTemplate(design: Design, def: CompositeDef): CompositeDef {
  if (def.uuid) {
    const origin = Object.values(design.library).find((t) => t.uuid === def.uuid)
    if (origin) return origin
  }
  const copy = cloneComposite(def, allCompositeIds(design))
  copy.name = uniqueAgainst(templateNames(design), def.name)
  copy.uuid = newUuid()
  for (const port of copy.ports) delete port.inverted
  design.library[copy.id] = copy
  return copy
}

/**
 * Regenerate an array composite's internals from its first copy (the array is
 * self-describing: its copies *are* the template), keeping its id/name/uuid and its
 * ports (so external wiring survives) while swapping the instances/connections.
 */
function regenerateArray(s: EditorState, inst: Instance, count: number, chains: ArrayChain[], orientation: ArrayOrientation, common: string[]): void {
  const def = inst.def
  if (def.kind !== 'composite') return
  const source = def.instances.find((i) => i.def.kind === 'composite')
  if (!source || source.def.kind !== 'composite') return
  const fresh = arrayComposite(source.def, count, chains, allCompositeIds(s.design), orientation, common)
  def.instances = fresh.instances
  def.connections = fresh.connections
  def.ports = fresh.ports
  def.arrayConfig = fresh.arrayConfig
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

/** The outside-world components placeable in the test-bench sheet (the "Testing" tab). */
export const TEST_IO_KINDS: PrimitiveKind[] = ['clock', 'switch-array', 'led-array', 'seven-seg', 'probe']

/** Return the design's test bench, creating an empty one on first use. */
function ensureTestbench(s: EditorState): Testbench {
  if (!s.design.testbench) s.design.testbench = emptyTestbench()
  return s.design.testbench
}

// Memoize the synthesized test-bench composite on object identity, so the width solver's
// per-root cache stays warm across draws (the composite is rebuilt only when the root or
// the test-bench content actually change — immer gives them fresh identities on edit).
let tbCacheRoot: CompositeDef | undefined
let tbCacheTestbench: Testbench | undefined
let tbCacheComposite: CompositeDef | null = null

/**
 * The synthesized test-bench composite for a design (memoized). The "Testing" canvas
 * renders and hit-tests against this composite and resolves widths against it.
 */
export function currentTestbenchComposite(design: Design): CompositeDef {
  if (tbCacheRoot === design.root && tbCacheTestbench === design.testbench && tbCacheComposite) {
    return tbCacheComposite
  }
  tbCacheRoot = design.root
  tbCacheTestbench = design.testbench
  tbCacheComposite = testbenchComposite(design, design.testbench ?? emptyTestbench())
  return tbCacheComposite
}

/** An empty starting design: an empty root sheet (built-ins are inline references). */
export function createDemoDesign(): Design {
  return {
    version: 2,
    root: { kind: 'composite', id: 'main', name: 'main', uuid: newUuid(), ports: [], instances: [], connections: [] },
    library: {},
    testbench: emptyTestbench(),
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
      pendingArray: null,
      pendingDelete: null,
      pendingClearAll: false,
      pendingCategoryDelete: false,
      romDialog: null,
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
          // instances and probes are never grouped — ignore a selection with no real
          // components.
          const movable = s.selectedIds.filter((id) => {
            const inst = def.instances.find((i) => i.id === id)
            return !!inst && !isPortGroupDef(inst.def) && !isProbeDef(inst.def)
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
          const inputPull = inferred.inputs.map((g) => g.pull)
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
              for (const [i, pull] of inputPull.entries()) {
                const port = inputPorts(copy.ports)[i]
                if (port && pull) port.pull = pull
              }
            }
          }
          s.selectedIds = last ? [last.id] : []
        }),
      cancelGroup: () => set((s) => void (s.pendingGroup = null)),
      openArrayDialog: () =>
        set((s) => {
          const def = currentDef(s)
          if (!def || def.kind !== 'composite') return
          if (s.selectedIds.length !== 1) return
          const inst = def.instances.find((i) => i.id === s.selectedIds[0])
          if (!inst || inst.def.kind !== 'composite') return
          const existing = inst.def.arrayConfig
          s.pendingArray = {
            instanceId: inst.id,
            count: existing?.count ?? 2,
            chains: existing ? existing.chains.map((c) => ({ from: c.from, to: c.to })) : [],
            orientation: existing?.orientation ?? 'horizontal',
            common: existing ? [...existing.common] : [],
            newLayer: false,
          }
        }),
      setArrayDialogCount: (count) =>
        set((s) => {
          if (s.pendingArray) s.pendingArray.count = Math.max(1, Math.floor(count))
        }),
      setArrayDialogChains: (chains) =>
        set((s) => {
          if (s.pendingArray) s.pendingArray.chains = chains.map((c) => ({ from: c.from, to: c.to }))
        }),
      setArrayDialogOrientation: (orientation) =>
        set((s) => {
          if (s.pendingArray) s.pendingArray.orientation = orientation
        }),
      setArrayDialogCommon: (common) =>
        set((s) => {
          if (s.pendingArray) s.pendingArray.common = [...common]
        }),
      setArrayDialogNewLayer: (newLayer) =>
        set((s) => {
          const p = s.pendingArray
          if (!p) return
          p.newLayer = newLayer
          if (newLayer) {
            // A new layer is configured fresh, not from the wrapped array's config.
            p.count = 2
            p.chains = []
            p.common = []
            p.orientation = 'horizontal'
          }
        }),
      confirmArray: () =>
        set((s) => {
          const p = s.pendingArray
          if (!p) return
          const def = currentDef(s)
          s.pendingArray = null
          if (!def || def.kind !== 'composite') return
          const inst = def.instances.find((i) => i.id === p.instanceId)
          if (!inst || inst.def.kind !== 'composite') return
          if (inst.def.arrayConfig && !p.newLayer) {
            // Re-configuring an existing array: regenerate its internals in place
            // (rather than nesting another array around it).
            regenerateArray(s, inst, p.count, p.chains, p.orientation, p.common)
          } else {
            const template = resolveArrayTemplate(s.design, inst.def)
            inst.def = arrayComposite(template, p.count, p.chains, allCompositeIds(s.design), p.orientation, p.common)
          }
          s.selectedIds = [inst.id]
        }),
      cancelArray: () => set((s) => void (s.pendingArray = null)),
      setArrayCount: (instanceId, count) =>
        set((s) => {
          const def = currentDef(s)
          if (!def || def.kind !== 'composite') return
          const inst = def.instances.find((i) => i.id === instanceId)
          if (!inst || inst.def.kind !== 'composite' || !inst.def.arrayConfig) return
          const n = Math.max(1, Math.floor(count))
          if (n === inst.def.arrayConfig.count) return
          regenerateArray(s, inst, n, inst.def.arrayConfig.chains, inst.def.arrayConfig.orientation, inst.def.arrayConfig.common)
        }),
      setArrayChains: (instanceId, chains) =>
        set((s) => {
          const def = currentDef(s)
          if (!def || def.kind !== 'composite') return
          const inst = def.instances.find((i) => i.id === instanceId)
          if (!inst || inst.def.kind !== 'composite' || !inst.def.arrayConfig) return
          regenerateArray(s, inst, inst.def.arrayConfig.count, chains, inst.def.arrayConfig.orientation, inst.def.arrayConfig.common)
        }),
      setArrayOrientation: (instanceId, orientation) =>
        set((s) => {
          const def = currentDef(s)
          if (!def || def.kind !== 'composite') return
          const inst = def.instances.find((i) => i.id === instanceId)
          if (!inst || inst.def.kind !== 'composite' || !inst.def.arrayConfig) return
          if (orientation === inst.def.arrayConfig.orientation) return
          regenerateArray(s, inst, inst.def.arrayConfig.count, inst.def.arrayConfig.chains, orientation, inst.def.arrayConfig.common)
        }),
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
      requestClearAll: () => set((s) => void (s.pendingClearAll = true)),
      cancelClearAll: () => set((s) => void (s.pendingClearAll = false)),
      confirmClearAll: (selection) => {
        set((s) => {
          s.pendingClearAll = false
          let design = s.design
          if (selection.tree) {
            design = { ...design, root: { ...design.root, instances: [], connections: [], ports: [] } }
          }
          for (const id of selection.templateIds) design = deleteTemplate(design, id)
          s.design = design
          resetAfterBulkDelete(s)
        })
        useEditorStore.temporal.getState().clear()
      },
      requestCategoryDelete: () => set((s) => void (s.pendingCategoryDelete = true)),
      cancelCategoryDelete: () => set((s) => void (s.pendingCategoryDelete = false)),
      openRomDialog: (instanceId) => set((s) => void (s.romDialog = { instanceId })),
      closeRomDialog: () => set((s) => void (s.romDialog = null)),
      confirmCategoryDelete: (categoryNames) => {
        set((s) => {
          s.pendingCategoryDelete = false
          const names = new Set(categoryNames)
          const ids = Object.values(s.design.library)
            .filter((d) => isTemplateDef(s.design, d))
            .filter((d) => names.has(templateCategory(d)))
            .map((d) => d.id)
          let design = s.design
          for (const id of ids) design = deleteTemplate(design, id)
          s.design = design
          resetAfterBulkDelete(s)
        })
      },
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
      togglePinPull: (ref, pull) =>
        set((s) => {
          const def = currentDef(s)
          if (!def || def.kind !== 'composite') return
          const inst = def.instances.find((i) => i.id === ref.instanceId)
          if (!inst) return
          const instDef = inst.def
          // Pull is external-only, applied to a placed instance's input terminal; the
          // current scope's own terminals (the input/output port groups) are never pullable.
          if (isPortGroupDef(instDef)) return
          if (instDef.kind === 'composite' && isTemplateDef(s.design, instDef)) return
          const port = childPorts(instDef).find((p) => p.id === ref.portId)
          if (!port || port.direction !== 'input') return
          if (port.pull === pull) delete port.pull
          else port.pull = pull
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
          if (childPrimitive(inst.def) === 'counter' && (name === 'terminalType' || name === 'width')) {
            if (name === 'terminalType') {
              applyCounterTerminalType(def, inst, value === 'wire' ? 'wire' : 'bus')
            } else {
              if (!inst.props) inst.props = {}
              inst.props.width = value
              applyCounterPorts(def, inst)
            }
            return
          }
          if (childPrimitive(inst.def) === 'register' && (name === 'terminalType' || name === 'width')) {
            if (name === 'terminalType') {
              applyRegisterTerminalType(def, inst, value === 'wire' ? 'wire' : 'bus')
            } else {
              if (!inst.props) inst.props = {}
              inst.props.width = value
              applyRegisterPorts(def, inst)
            }
            return
          }
          if (childPrimitive(inst.def) === 'rom' && name === 'access') {
            applyRomAccess(def, inst, value === 'sync' ? 'sync' : 'async')
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
          const err = connectionError(currentWidthRoot(s), def, from, to)
          if (err) {
            s.notice = err
            return
          }
          def.connections.push({ id: nextConnectionId(def.connections), from, to })
        }),
      connectAutoMatches: () =>
        set((s) => {
          const def = currentDef(s)
          if (!def || def.kind !== 'composite') return
          const matches = computeAutoConnectMatches(currentWidthRoot(s), def, s.selectedIds)
          if (matches.length === 0) return
          const conns = def.connections
          let added = 0
          for (const m of matches) {
            // Re-guard the single-driver invariant and width compatibility (the design
            // may have changed since the preview was computed).
            if (findConnectionTo(conns, m.to)) continue
            if (connectionError(currentWidthRoot(s), def, m.from, m.to)) continue
            conns.push({ id: nextConnectionId(conns), from: m.from, to: m.to })
            added += 1
          }
          if (added > 0) s.notice = `Connected ${added} terminal(s)`
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
          const err = connectionError(currentWidthRoot(s), def, original.from, to)
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
      removeConnections: (ids) =>
        set((s) => {
          const def = currentDef(s)
          if (!def || def.kind !== 'composite') return
          const idSet = new Set(ids)
          def.connections = def.connections.filter((c) => !idSet.has(c.id))
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
      applyTemplateToAll: (templateId) =>
        set((s) => {
          const { design, updated } = applyTemplateToAll(s.design, templateId)
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

      addTestInstance: (kind, pos) =>
        set((s) => {
          if (!isPrimitiveKind(kind) || !TEST_IO_KINDS.includes(kind)) return
          const tb = ensureTestbench(s)
          const srcDef = forkOf(kind)
          const primitive = childPrimitive(srcDef)
          // Default instance name is empty, except CLOCK which keeps its label.
          const name = primitive === 'clock' ? childLabel(srcDef) : ''
          const id = uniqueAgainst(new Set(tb.instances.map((i) => i.id)), childLabel(srcDef))
          const copied = cloneChildDef(srcDef, allCompositeIds(s.design))
          const props = primitive ? defaultPropsOf(primitive) : {}
          tb.instances.push({ id, name, def: copied, pos: { x: pos.x, y: pos.y }, ...(Object.keys(props).length ? { props } : {}) })
        }),

      setMainPos: (pos) =>
        set((s) => {
          ensureTestbench(s).main.pos = pos
        }),

      setTestInstancesPosition: (ids, positions) =>
        set((s) => {
          const tb = ensureTestbench(s)
          ids.forEach((id, i) => {
            if (id === MAIN_INSTANCE_ID) {
              tb.main.pos = positions[i]
              return
            }
            const inst = tb.instances.find((x) => x.id === id)
            if (inst) inst.pos = positions[i]
          })
        }),

      setTestInstanceProp: (id, name, value) =>
        set((s) => {
          const tb = ensureTestbench(s)
          const inst = tb.instances.find((x) => x.id === id)
          if (!inst) return
          // An array's terminal-type change regenerates its ports and prunes its wiring,
          // reusing the same rule as the designer (via the synthesized test-bench composite).
          if (isArrayDef(inst.def) && name === 'terminalType') {
            const composite = testbenchComposite(s.design, tb)
            applyArrayTerminalType(composite, inst, value === 'wire' ? 'wire' : 'bus')
            tb.connections = composite.connections
            return
          }
          if (!inst.props) inst.props = {}
          inst.props[name] = value
        }),

      addTestConnection: (from, to) =>
        set((s) => {
          const tb = ensureTestbench(s)
          const composite = testbenchComposite(s.design, tb)
          if (findConnectionTo(tb.connections, to)) {
            s.notice = 'Input already has a driver'
            return
          }
          const err = connectionError(composite, composite, from, to)
          if (err) {
            s.notice = err
            return
          }
          tb.connections.push({ id: nextConnectionId(tb.connections), from, to })
        }),

      retargetTestConnection: (id, to) =>
        set((s) => {
          const tb = ensureTestbench(s)
          const original = tb.connections.find((c) => c.id === id)
          if (!original) return
          const conflict = findConnectionTo(tb.connections, to)
          if (conflict && conflict.id !== id) {
            s.notice = 'Input already has a driver'
            return
          }
          const composite = testbenchComposite(s.design, tb)
          const err = connectionError(composite, composite, original.from, to)
          if (err) {
            s.notice = err
            return
          }
          original.to = to
        }),

      removeTestConnection: (id) =>
        set((s) => {
          const tb = ensureTestbench(s)
          tb.connections = tb.connections.filter((c) => c.id !== id)
        }),

      deleteTestInstances: (ids) =>
        set((s) => {
          const tb = ensureTestbench(s)
          // The fixed `main` box is never deletable.
          const removed = new Set(ids.filter((id) => id !== MAIN_INSTANCE_ID))
          tb.instances = tb.instances.filter((i) => !removed.has(i.id))
          tb.connections = tb.connections.filter(
            (c) => !removed.has(c.from.instanceId) && !removed.has(c.to.instanceId),
          )
        }),
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
