import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * UI preferences, persisted to localStorage under the key `gatefold-ui`. Keep this
 * store limited to pure presentation state (theme, panel sizes) — document/editing
 * state lives in `editorStore`.
 */

export type Theme = 'light' | 'dark'

interface UiState {
  theme: Theme
  sidebarWidth: number
  libraryWidth: number
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  setSidebarWidth: (width: number) => void
  setLibraryWidth: (width: number) => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      sidebarWidth: 260,
      libraryWidth: 260,
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set({ theme: get().theme === 'dark' ? 'light' : 'dark' }),
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
      setLibraryWidth: (libraryWidth) => set({ libraryWidth }),
    }),
    { name: 'gatefold-ui' },
  ),
)
