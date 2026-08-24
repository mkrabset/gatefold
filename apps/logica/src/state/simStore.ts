import { create } from 'zustand'
import type { Signal } from '@logica/model'
import { Simulation } from '@logica/sim'
import { DEFAULT_CONFIG, type SimConfig } from '@logica/sim'
import { INSTANCE_PATH_SEP, joinInstancePath } from '@logica/sim'
import { useEditorStore } from './editorStore'
import { useUiStore } from './uiStore'

type SimMode = 'design' | 'simulate'

const SIGNAL_COLORS: Record<Signal, { dark: string; light: string }> = {
  1: { dark: '#ef4444', light: '#dc2626' },
  0: { dark: '#4b5563', light: '#111827' },
  x: { dark: '#6b7280', light: '#9ca3af' },
}

/** Simulated time (ps) advanced per run tick (~16 ms). */
const RUN_STEP = 1000

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

  return {
    mode: 'design',
    running: false,
    path: [],
    version: 0,
    engine: null,
    stepMode: 'quiescent',
    defaultDelay: DEFAULT_CONFIG.defaultDelay,
    settingsOpen: false,

    toggleMode: () => {
      const { mode } = get()
      if (mode === 'design') {
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
      } else {
        get().stop()
        set({ mode: 'design', engine: null, path: [], version: get().version + 1 })
      }
    },

    run: () => {
      const { engine, running } = get()
      if (running || !engine) return
      set({ running: true })
      runTimer = setInterval(() => {
        const { engine } = get()
        if (!engine) return
        engine.advanceTo(engine.time + RUN_STEP)
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

    openSettings: () => set({ settingsOpen: true }),
    closeSettings: () => set({ settingsOpen: false }),
  }
})

function flatId(instanceId: string): string {
  const { path } = useSimStore.getState()
  return joinInstancePath(path.join(INSTANCE_PATH_SEP), instanceId)
}

/** The full bit-vector signal for a flattened pin, or undefined when not simulating. */
function rawSignalOf(instanceId: string, portId: string): Signal[] | undefined {
  const { engine, mode } = useSimStore.getState()
  if (mode !== 'simulate' || !engine) return undefined
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
