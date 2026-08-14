import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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
      libraryWidth: 180,
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set({ theme: get().theme === 'dark' ? 'light' : 'dark' }),
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
      setLibraryWidth: (libraryWidth) => set({ libraryWidth }),
    }),
    { name: 'logica-ui' },
  ),
)
