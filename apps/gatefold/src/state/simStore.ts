import { create } from 'zustand'
import type { Signal, ValueFormat, ValueOrder } from '@gatefold/model'
import { MAIN_INSTANCE_ID, invertSignal, withTestbench } from '@gatefold/model'
import { Simulation, HistoryBuffer } from '@gatefold/sim'
import { DEFAULT_CONFIG, type SimConfig } from '@gatefold/sim'
import { INSTANCE_PATH_SEP, joinInstancePath } from '@gatefold/sim'
import { resolveNav, useEditorStore } from './editorStore'
import { useUiStore } from './uiStore'

type SimMode = 'design' | 'simulate'

const SIGNAL_COLORS: Record<Signal, { dark: string; light: string }> = {
  1: { dark: '#ef4444', light: '#dc2626' },
  0: { dark: '#4b5563', light: '#111827' },
  x: { dark: '#fde047', light: '#eab308' },
}

/** A run tick advances the engine by this much simulated time (ps) per real tick. */
const RUN_TICK_PS = 16_000_000_000 // 16 ms

/** Default simulation speed: slow enough that the default 100 000 ps clock is visible. */
const DEFAULT_TIME_SCALE = 0.001

interface SimState {
  mode: SimMode
  running: boolean
  /** Instance-id path from the root to the currently-viewed def (parallel to navStack). */
  path: string[]
  /** Bumped on every signal change so the canvas knows to redraw. */
  version: number
  engine: Simulation | null
  /** Probe-signal history recorder (kept after leaving simulate mode for the timeline). */
  history: HistoryBuffer | null
  /** User's probe display order (group labels), or null for the natural order. */
  probeOrder: string[] | null
  /** How the Step button advances. */
  stepMode: SimConfig['stepMode']
  /** Default gate propagation delay, in picoseconds. */
  defaultDelay: number
  /** Simulated-time per real-time multiplier (1 = real-time). */
  timeScale: number
  settingsOpen: boolean
  /** The set-value dialog target (a switch-array), or null when closed. `test` marks a
   *  test-bench switch (committed via the raw id), vs a designer switch (committed via
   *  the `path`-prefixed id). */
  switchDialog: { instanceId: string; size: number; lanes: Signal[]; format: ValueFormat; order: ValueOrder; test: boolean } | null
  toggleMode: () => void
  run: () => void
  step: () => void
  stop: () => void
  reset: () => void
  toggleSwitch: (instanceId: string, lane?: number) => void
  stepSwitch: (instanceId: string, delta: number) => void
  openSwitchDialog: (instanceId: string, size: number, format: ValueFormat, order: ValueOrder) => void
  closeSwitchDialog: () => void
  setSwitchValue: (instanceId: string, lanes: Signal[]) => void
  toggleTestSwitch: (instanceId: string, lane?: number) => void
  stepTestSwitch: (instanceId: string, delta: number) => void
  openTestSwitchDialog: (instanceId: string, size: number, format: ValueFormat, order: ValueOrder) => void
  setTestSwitchValue: (instanceId: string, lanes: Signal[]) => void
  descend: (instanceId: string) => void
  ascend: () => void
  setStepMode: (mode: SimConfig['stepMode']) => void
  setDefaultDelay: (ps: number) => void
  setTimeScale: (scale: number) => void
  setProbeOrder: (order: string[] | null) => void
  openSettings: () => void
  closeSettings: () => void
}

let runTimer: ReturnType<typeof setInterval> | null = null

export const useSimStore = create<SimState>()((set, get): SimState => {
  const config = (): SimConfig => ({
    ...DEFAULT_CONFIG,
    defaultDelay: get().defaultDelay,
    stepMode: get().stepMode,
  })
  const rebuild = (): { engine: Simulation; history: HistoryBuffer } => {
    const ui = useUiStore.getState()
    const history = new HistoryBuffer(ui.maxHistoryEvents, ui.historyLimitMode)
    // Simulate the test bench: it wraps `design.root` in a `main` instance plus any
    // external IO components, so the outside world drives the top-level interface.
    const design = useEditorStore.getState().design
    const engine = new Simulation(withTestbench(design), config(), history)
    // Drop the wrapper's leading `<rootName>.` segment from probe labels.
    const rootName = design.root.name
    const groups: { label: string; lanes: number }[] = []
    for (let i = 0; i < history.groupCount; i++) {
      const label = history.groupLabel(i)
      const prefix = `${rootName}.`
      groups.push({ label: label.startsWith(prefix) ? label.slice(prefix.length) : label, lanes: history.groupLanes(i) })
    }
    history.setGroups(groups)
    return { engine, history }
  }

  /** Enter simulate mode from design mode: build the engine and reset to the top level. */
  const enterSim = (): void => {
    // Simulate from the top; navigation within the simulation is tracked by `path`.
    useEditorStore.getState().resetNavigation()
    const { engine, history } = rebuild()
    // The designer's root is the `main` instance inside the test-bench wrapper.
    set({ mode: 'simulate', engine, history, probeOrder: null, path: [MAIN_INSTANCE_ID], version: get().version + 1 })
  }

  return {
    mode: 'design',
    running: false,
    path: [],
    version: 0,
    engine: null,
    history: null,
    probeOrder: null,
    stepMode: 'quiescent',
    defaultDelay: DEFAULT_CONFIG.defaultDelay,
    timeScale: DEFAULT_TIME_SCALE,
    settingsOpen: false,
    switchDialog: null,

    toggleMode: () => {
      if (get().mode === 'design') {
        enterSim()
      } else {
        get().stop()
        set({ mode: 'design', engine: null, path: [], version: get().version + 1 })
      }
    },

    run: () => {
      if (get().running) return
      // Enter simulate mode first if needed, then start running.
      if (get().mode === 'design') enterSim()
      const engine = get().engine
      if (!engine) return
      // Fresh timing lamps on each play/resume.
      engine.resetTiming()
      set({ running: true })
      runTimer = setInterval(() => {
        const { engine, history } = get()
        if (!engine) return
        // Advance a fixed slice of simulated time (a multiple of real time), then settle
        // so the circuit is never left mid-cascade (e.g. when pausing). A clock slower
        // than the slice just fires its edge on a later tick.
        const slice = Math.max(1, Math.round(RUN_TICK_PS * get().timeScale))
        engine.advanceTo(engine.time + slice)
        engine.settle()
        set((s) => ({ version: s.version + 1 }))
        // STOP limit mode: pause once the history buffer is full.
        if (history?.full) get().stop()
      }, 16)
    },

    step: () => {
      const { engine } = get()
      if (!engine) return
      engine.step()
      set((s) => ({ version: s.version + 1 }))
    },

    stop: () => {
      if (runTimer) {
        clearInterval(runTimer)
        runTimer = null
      }
      set({ running: false })
    },

    reset: () => {
      get().stop()
      const { engine, history } = rebuild()
      set({ engine, history, probeOrder: null, version: get().version + 1 })
    },

    toggleSwitch: (instanceId, lane = 0) => {
      const { engine } = get()
      if (!engine) return
      if (!viewingLive()) return
      const id = flatId(instanceId)
      engine.toggleSwitch(id, lane)
      engine.step()
      set((s) => ({ version: s.version + 1 }))
    },

    stepSwitch: (instanceId, delta) => {
      const { engine } = get()
      if (!engine || !viewingLive()) return
      engine.incrementSwitch(flatId(instanceId), delta)
      engine.step()
      set((s) => ({ version: s.version + 1 }))
    },

    openSwitchDialog: (instanceId, size, format, order) => {
      const { engine } = get()
      if (!engine || !viewingLive()) return
      const lanes = engine.switchLanesOf(flatId(instanceId))
      if (!lanes) return
      set({ switchDialog: { instanceId, size, lanes, format, order, test: false } })
    },

    closeSwitchDialog: () => set({ switchDialog: null }),

    setSwitchValue: (instanceId, lanes) => {
      const { engine } = get()
      if (!engine || !viewingLive()) return
      engine.setSwitchLanes(flatId(instanceId), lanes)
      engine.step()
      set((s) => ({ switchDialog: null, version: s.version + 1 }))
    },

    toggleTestSwitch: (instanceId, lane = 0) => {
      const { engine } = get()
      if (!engine) return
      engine.toggleSwitch(instanceId, lane)
      engine.step()
      set((s) => ({ version: s.version + 1 }))
    },

    stepTestSwitch: (instanceId, delta) => {
      const { engine } = get()
      if (!engine) return
      engine.incrementSwitch(instanceId, delta)
      engine.step()
      set((s) => ({ version: s.version + 1 }))
    },

    openTestSwitchDialog: (instanceId, size, format, order) => {
      const { engine } = get()
      if (!engine) return
      const lanes = engine.switchLanesOf(instanceId)
      if (!lanes) return
      set({ switchDialog: { instanceId, size, lanes, format, order, test: true } })
    },

    setTestSwitchValue: (instanceId, lanes) => {
      const { engine } = get()
      if (!engine) return
      engine.setSwitchLanes(instanceId, lanes)
      engine.step()
      set((s) => ({ switchDialog: null, version: s.version + 1 }))
    },

    descend: (instanceId) => set((s) => ({ path: [...s.path, instanceId] })),
    ascend: () => set((s) => ({ path: s.path.slice(0, -1) })),

    setStepMode: (mode) => {
      set({ stepMode: mode })
      get().engine?.setStepMode(mode)
    },

    setDefaultDelay: (ps) => {
      get().stop()
      set({ defaultDelay: ps })
      const { engine, history } = rebuild()
      set({ engine, history, probeOrder: null, version: get().version + 1 })
    },

    setTimeScale: (scale) => set({ timeScale: scale }),

    setProbeOrder: (probeOrder) => set({ probeOrder }),

    openSettings: () => set({ settingsOpen: true }),
    closeSettings: () => set({ settingsOpen: false }),
  }
})

function flatId(instanceId: string): string {
  const { path } = useSimStore.getState()
  return joinInstancePath(path.join(INSTANCE_PATH_SEP), instanceId)
}

/**
 * Whether the currently-viewed def (top of `navStack`) is the live def at the current
 * `path`. When the user navigates into a def that is not part of the running simulation
 * (e.g. a library template), the signal/pin ids no longer correspond to flattened netlist
 * keys, so signal lookups and switch toggles must be suppressed. The walk starts from the
 * test-bench wrapper (the simulation root), whose `main` instance holds `design.root`.
 */
function viewingLive(): boolean {
  const { path } = useSimStore.getState()
  const editor = useEditorStore.getState()
  let def: import('@gatefold/model').ChildDef = withTestbench(editor.design).root
  for (const id of path) {
    if (def.kind !== 'composite') return false
    const inst: import('@gatefold/model').Instance | undefined = def.instances.find((i) => i.id === id)
    if (!inst) return false
    def = inst.def
  }
  return resolveNav(editor.design, editor.navStack) === def
}

/** The full bit-vector signal for a flattened pin, or undefined when not simulating. */
function rawSignalOf(instanceId: string, portId: string): Signal[] | undefined {
  const { engine, mode } = useSimStore.getState()
  if (mode !== 'simulate' || !engine) return undefined
  if (!viewingLive()) return undefined
  return engine.signalOf(flatId(instanceId), portId)
}

/** Theme-aware color for a 3-state signal value (shared by the canvas and timeline). */
export function signalColor(signal: Signal, theme: string): string {
  return SIGNAL_COLORS[signal][theme === 'dark' ? 'dark' : 'light']
}

/** Resolve a wire/marker color for a pin (optionally a specific bus lane, or the logical
 *  value at an inverted terminal via `inverted`). */
export function simColorOf(instanceId: string, portId: string, lane?: number, inverted = false): string | undefined {
  const sig = rawSignalOf(instanceId, portId)
  if (!sig) return undefined
  const bit = lane !== undefined ? sig[lane] : sig.length === 1 ? sig[0] : undefined
  if (bit === undefined) return undefined
  const theme = useUiStore.getState().theme
  return signalColor(inverted ? invertSignal(bit) : bit, theme)
}

/** Resolve a single-bit signal for a pin (probe state), or undefined. */
export function simValueOf(instanceId: string, portId: string): Signal | undefined {
  const sig = rawSignalOf(instanceId, portId)
  return sig && sig.length === 1 ? sig[0] : undefined
}

/** Resolve the full bit-vector signal for a pin, or undefined. */
export function simSignalOf(instanceId: string, portId: string): Signal[] | undefined {
  return rawSignalOf(instanceId, portId)
}

/**
 * Resolve a signal at the test-bench top level (the "Testing" tab). Unlike the designer,
 * the test-bench sheet is always live (it is the simulation root), so there is no
 * `viewingLive` gate and no `path` prefix — the instance id is the flattened id as-is.
 */
function testRawSignalOf(instanceId: string, portId: string): Signal[] | undefined {
  const { engine, mode } = useSimStore.getState()
  if (mode !== 'simulate' || !engine) return undefined
  return engine.signalOf(instanceId, portId)
}

/** Theme-aware wire/marker color for a test-bench pin (optionally a specific lane, or the
 *  logical value at an inverted terminal via `inverted`). */
export function testColorOf(instanceId: string, portId: string, lane?: number, inverted = false): string | undefined {
  const sig = testRawSignalOf(instanceId, portId)
  if (!sig) return undefined
  const bit = lane !== undefined ? sig[lane] : sig.length === 1 ? sig[0] : undefined
  if (bit === undefined) return undefined
  return signalColor(inverted ? invertSignal(bit) : bit, useUiStore.getState().theme)
}

/** Single-bit signal on a test-bench pin, or undefined. */
export function testValueOf(instanceId: string, portId: string): Signal | undefined {
  const sig = testRawSignalOf(instanceId, portId)
  return sig && sig.length === 1 ? sig[0] : undefined
}

/** Full bit-vector signal on a test-bench pin, or undefined. */
export function testSignalOf(instanceId: string, portId: string): Signal[] | undefined {
  return testRawSignalOf(instanceId, portId)
}
