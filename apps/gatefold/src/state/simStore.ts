import { create } from 'zustand'
import type { Signal } from '@gatefold/model'
import { Simulation } from '@gatefold/sim'
import { DEFAULT_CONFIG, type SimConfig } from '@gatefold/sim'
import { INSTANCE_PATH_SEP, joinInstancePath } from '@gatefold/sim'
import { useEditorStore } from './editorStore'
import { useUiStore } from './uiStore'

type SimMode = 'design' | 'simulate'

const SIGNAL_COLORS: Record<Signal, { dark: string; light: string }> = {
  1: { dark: '#ef4444', light: '#dc2626' },
  0: { dark: '#4b5563', light: '#111827' },
  x: { dark: '#6b7280', light: '#9ca3af' },
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
  /** How the Step button advances. */
  stepMode: SimConfig['stepMode']
  /** Default gate propagation delay, in picoseconds. */
  defaultDelay: number
  /** Simulated-time per real-time multiplier (1 = real-time). */
  timeScale: number
  settingsOpen: boolean
  toggleMode: () => void
  run: () => void
  step: () => void
  stop: () => void
  reset: () => void
  toggleSwitch: (instanceId: string, lane?: number) => void
  descend: (instanceId: string) => void
  ascend: () => void
  setStepMode: (mode: SimConfig['stepMode']) => void
  setDefaultDelay: (ps: number) => void
  setTimeScale: (scale: number) => void
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
  const rebuild = (): Simulation => new Simulation(useEditorStore.getState().design, config())

  /** Enter simulate mode from design mode: build the engine and reset to the top level. */
  const enterSim = (): void => {
    const design = useEditorStore.getState().design
    const viewport = useEditorStore.getState().viewport
    // Simulate from the top; navigation within the simulation is tracked by `path`.
    useEditorStore.setState({
      navStack: [design.root],
      viewportStack: [viewport],
      selectedIds: [],
      marquee: null,
      pendingWire: null,
      hoverPort: null,
    })
    set({ mode: 'simulate', engine: rebuild(), path: [], version: get().version + 1 })
  }

  return {
    mode: 'design',
    running: false,
    path: [],
    version: 0,
    engine: null,
    stepMode: 'quiescent',
    defaultDelay: DEFAULT_CONFIG.defaultDelay,
    timeScale: DEFAULT_TIME_SCALE,
    settingsOpen: false,

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
        const { engine } = get()
        if (!engine) return
        // Advance a fixed slice of simulated time (a multiple of real time), then settle
        // so the circuit is never left mid-cascade (e.g. when pausing). A clock slower
        // than the slice just fires its edge on a later tick.
        const slice = Math.max(1, Math.round(RUN_TICK_PS * get().timeScale))
        engine.advanceTo(engine.time + slice)
        engine.settle()
        set((s) => ({ version: s.version + 1 }))
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
      set({ engine: rebuild(), version: get().version + 1 })
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

    descend: (instanceId) => set((s) => ({ path: [...s.path, instanceId] })),
    ascend: () => set((s) => ({ path: s.path.slice(0, -1) })),

    setStepMode: (mode) => {
      set({ stepMode: mode })
      get().engine?.setStepMode(mode)
    },

    setDefaultDelay: (ps) => {
      get().stop()
      set({ defaultDelay: ps })
      set({ engine: rebuild(), version: get().version + 1 })
    },

    setTimeScale: (scale) => set({ timeScale: scale }),

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
 * keys, so signal lookups and switch toggles must be suppressed.
 */
function viewingLive(): boolean {
  const { path } = useSimStore.getState()
  const editor = useEditorStore.getState()
  let def = editor.design.defs[editor.design.root]
  if (!def) return false
  for (const id of path) {
    const inst = def.instances?.find((i) => i.id === id)
    const next = inst && editor.design.defs[inst.defId]
    if (!next) return false
    def = next
  }
  return def.id === editor.navStack[editor.navStack.length - 1]
}

/** The full bit-vector signal for a flattened pin, or undefined when not simulating. */
function rawSignalOf(instanceId: string, portId: string): Signal[] | undefined {
  const { engine, mode } = useSimStore.getState()
  if (mode !== 'simulate' || !engine) return undefined
  if (!viewingLive()) return undefined
  return engine.signalOf(flatId(instanceId), portId)
}

/** Resolve a wire/marker color for a pin (optionally a specific bus lane). */
export function simColorOf(instanceId: string, portId: string, lane?: number): string | undefined {
  const sig = rawSignalOf(instanceId, portId)
  if (!sig) return undefined
  const bit = lane !== undefined ? sig[lane] : sig.length === 1 ? sig[0] : undefined
  if (bit === undefined) return undefined
  const theme = useUiStore.getState().theme
  return SIGNAL_COLORS[bit][theme === 'dark' ? 'dark' : 'light']
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

/** The timing-breach lamp state for a design with exactly one clock. */
export function simTimingStatus(): { active: boolean; half: boolean; full: boolean } {
  const { engine, mode } = useSimStore.getState()
  if (mode !== 'simulate' || !engine) return { active: false, half: false, full: false }
  return {
    active: engine.hasSingleClock(),
    half: engine.timingHalfViolation,
    full: engine.timingFullViolation,
  }
}
