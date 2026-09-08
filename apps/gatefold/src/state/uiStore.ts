import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * UI preferences, persisted to localStorage under the key `gatefold-ui`. Keep this
 * store limited to pure presentation state (theme, panel sizes) — document/editing
 * state lives in `editorStore`.
 */

export type Theme = 'light' | 'dark'

/** The default bus-lane spacing in world units (the current `2 × 3.5` pitch). */
export const DEFAULT_LANE_DISTANCE = 7

interface UiState {
  theme: Theme
  sidebarWidth: number
  libraryWidth: number
  /** Bus-lane spacing in world units (0..DEFAULT_LANE_DISTANCE). */
  laneDistance: number
  /** Whether the global settings dialog is open. */
  settingsOpen: boolean
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  setSidebarWidth: (width: number) => void
  setLibraryWidth: (width: number) => void
  setLaneDistance: (distance: number) => void
  openSettings: () => void
  closeSettings: () => void
}

const clampLaneDistance = (distance: number): number =>
  Math.min(DEFAULT_LANE_DISTANCE, Math.max(0, distance))

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      sidebarWidth: 260,
      libraryWidth: 260,
      laneDistance: DEFAULT_LANE_DISTANCE,
      settingsOpen: false,
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set({ theme: get().theme === 'dark' ? 'light' : 'dark' }),
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
      setLibraryWidth: (libraryWidth) => set({ libraryWidth }),
      setLaneDistance: (laneDistance) => set({ laneDistance: clampLaneDistance(laneDistance) }),
      openSettings: () => set({ settingsOpen: true }),
      closeSettings: () => set({ settingsOpen: false }),
    }),
    { name: 'gatefold-ui' },
  ),
)
