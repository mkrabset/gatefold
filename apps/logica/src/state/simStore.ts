import { create } from 'zustand'
import type { Signal } from '@logica/model'
import { Simulation } from '@logica/sim'
import { DEFAULT_CONFIG } from '@logica/sim'
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
  toggleMode: () => void
  run: () => void
  step: () => void
  stop: () => void
  reset: () => void
  toggleSwitch: (instanceId: string) => void
  descend: (instanceId: string) => void
  ascend: () => void
}

let runTimer: ReturnType<typeof setInterval> | null = null

export const useSimStore = create<SimState>()((set, get): SimState => {
  const rebuild = (): Simulation => new Simulation(useEditorStore.getState().design, DEFAULT_CONFIG)

  return {
    mode: 'design',
    running: false,
    path: [],
    version: 0,
    engine: null,

    toggleMode: () => {
      const { mode } = get()
      if (mode === 'design') {
        const design = useEditorStore.getState().design
        // Simulate from the top; navigation within the simulation is tracked by `path`.
        useEditorStore.setState({
          navStack: [design.root],
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

    toggleSwitch: (instanceId) => {
      const { engine } = get()
      if (!engine) return
      const id = flatId(instanceId)
      const cur = engine.signal(id, 'out:0')
      engine.setSwitch(id, cur === 1 ? 0 : 1)
      engine.step()
      set((s) => ({ version: s.version + 1 }))
    },

    descend: (instanceId) => set((s) => ({ path: [...s.path, instanceId] })),
    ascend: () => set((s) => ({ path: s.path.slice(0, -1) })),
  }
})

function flatId(instanceId: string): string {
  const { path } = useSimStore.getState()
  return path.length === 0 ? instanceId : `${path.join('.')}.${instanceId}`
}

/** Resolve a wire/marker color for a pin (optionally a specific bus lane). */
export function simColorOf(instanceId: string, portId: string, lane?: number): string | undefined {
  const { engine, mode } = useSimStore.getState()
  if (mode !== 'simulate' || !engine) return undefined
  const sig = engine.signalOf(flatId(instanceId), portId)
  if (!sig) return undefined
  const bit = lane !== undefined ? sig[lane] : sig.length === 1 ? sig[0] : undefined
  if (bit === undefined) return undefined
  const theme = useUiStore.getState().theme
  return SIGNAL_COLORS[bit][theme === 'dark' ? 'dark' : 'light']
}

/** Resolve a single-bit signal for a pin (probe state), or undefined. */
export function simValueOf(instanceId: string, portId: string): Signal | undefined {
  const { engine, mode } = useSimStore.getState()
  if (mode !== 'simulate' || !engine) return undefined
  const sig = engine.signalOf(flatId(instanceId), portId)
  return sig && sig.length === 1 ? sig[0] : undefined
}
