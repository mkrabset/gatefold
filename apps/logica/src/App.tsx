import { useEffect } from 'react'
import { Canvas } from './editor/Canvas'
import { Toolbar } from './ui/Toolbar'
import { Sidebar } from './ui/Sidebar'
import { LibraryPanel } from './ui/LibraryPanel'
import { ResizeHandle } from './ui/ResizeHandle'
import { GroupDialog } from './ui/GroupDialog'
import { Toast } from './ui/Toast'
import { useUiStore } from './state/uiStore'
import { useEditorStore } from './state/editorStore'

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
        <Canvas />
        {/* direction=-1: library is right of the handle, drag right shrinks it */}
        <ResizeHandle value={libraryWidth} min={140} max={400} direction={-1} onChange={setLibraryWidth} />
        <LibraryPanel width={libraryWidth} />
      </div>
      <GroupDialog />
      <Toast />
    </div>
  )
}
