import { useEffect } from 'react'
import { Canvas } from './editor/Canvas'
import { Toolbar } from './ui/Toolbar'
import { Sidebar } from './ui/Sidebar'
import { LibraryPanel } from './ui/LibraryPanel'
import { ResizeHandle } from './ui/ResizeHandle'
import { GroupDialog } from './ui/GroupDialog'
import { DeleteDialog } from './ui/DeleteDialog'
import { ClearAllDialog } from './ui/ClearAllDialog'
import { DeleteCategoriesDialog } from './ui/DeleteCategoriesDialog'
import { SimSettingsDialog } from './ui/SimSettingsDialog'
import { SettingsDialog } from './ui/SettingsDialog'
import { SwitchValueDialog } from './ui/SwitchValueDialog'
import { RomContentsDialog } from './ui/RomContentsDialog'
import { TimelineView } from './ui/TimelineView'
import { Toast } from './ui/Toast'
import { useUiStore } from './state/uiStore'
import { useEditorStore } from './state/editorStore'
import { useSimStore } from './state/simStore'

/** True when the event targets a text entry, where editor shortcuts should be ignored. */
function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  )
}

/**
 * Root layout: toolbar on top, then a three-column main area (sidebar | canvas |
 * library) separated by draggable resize handles. Applies the active theme by setting
 * the `data-theme` attribute on `<html>`.
 */
export default function App() {
  const theme = useUiStore((s) => s.theme)
  const sidebarWidth = useUiStore((s) => s.sidebarWidth)
  const libraryWidth = useUiStore((s) => s.libraryWidth)
  const setSidebarWidth = useUiStore((s) => s.setSidebarWidth)
  const setLibraryWidth = useUiStore((s) => s.setLibraryWidth)
  const middleTab = useUiStore((s) => s.middleTab)
  const setMiddleTab = useUiStore((s) => s.setMiddleTab)
  const pendingClearAll = useEditorStore((s) => s.pendingClearAll)
  const pendingCategoryDelete = useEditorStore((s) => s.pendingCategoryDelete)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // Global editor shortcuts: copy, paste, delete, undo, redo.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTextInput(e.target)) return
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (mod && key === 'c') {
        e.preventDefault()
        useEditorStore.getState().copySelection()
      } else if (mod && key === 'v') {
        e.preventDefault()
        useEditorStore.getState().paste()
      } else if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault()
        useEditorStore.getState().deleteSelection()
      } else if (mod && key === 'z' && e.shiftKey) {
        e.preventDefault()
        useEditorStore.temporal.getState().redo()
      } else if (mod && key === 'y') {
        e.preventDefault()
        useEditorStore.temporal.getState().redo()
      } else if (mod && key === 'z') {
        e.preventDefault()
        useEditorStore.temporal.getState().undo()
      } else if (!mod && e.key === ' ') {
        // In simulate mode, Space toggles running / paused.
        const sim = useSimStore.getState()
        if (sim.mode !== 'simulate') return
        e.preventDefault()
        if (sim.running) sim.stop()
        else sim.run()
      } else if (!mod && key === 'c') {
        // Proximity auto-connect: wire up the currently previewed (orange) matches.
        if (useSimStore.getState().mode !== 'design') return
        e.preventDefault()
        useEditorStore.getState().connectAutoMatches()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="app">
      <Toolbar />
      <div className="main">
        <Sidebar width={sidebarWidth} />
        {/* direction=1: sidebar is left of the handle, drag right grows it */}
        <ResizeHandle value={sidebarWidth} min={160} max={480} direction={1} onChange={setSidebarWidth} />
        <div className="center">
          <div className="tabs" role="tablist">
            <button
              className={`tab${middleTab === 'designer' ? ' active' : ''}`}
              role="tab"
              aria-selected={middleTab === 'designer'}
              onClick={() => setMiddleTab('designer')}
            >
              Designer
            </button>
            <button
              className={`tab${middleTab === 'timeline' ? ' active' : ''}`}
              role="tab"
              aria-selected={middleTab === 'timeline'}
              onClick={() => setMiddleTab('timeline')}
            >
              Simulation timeline
            </button>
          </div>
          <div className="center-content">
            {middleTab === 'designer' ? <Canvas /> : <TimelineView />}
          </div>
        </div>
        {/* direction=-1: library is right of the handle, drag right shrinks it */}
        <ResizeHandle value={libraryWidth} min={220} max={440} direction={-1} onChange={setLibraryWidth} />
        <LibraryPanel width={libraryWidth} />
      </div>
      <GroupDialog />
      <DeleteDialog />
      {pendingClearAll && <ClearAllDialog />}
      {pendingCategoryDelete && <DeleteCategoriesDialog />}
      <SimSettingsDialog />
      <SettingsDialog />
      <SwitchValueDialog />
      <RomContentsDialog />
      <Toast />
    </div>
  )
}
