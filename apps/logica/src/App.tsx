import { useEffect } from 'react'
import { Canvas } from './editor/Canvas'
import { Toolbar } from './ui/Toolbar'
import { Sidebar } from './ui/Sidebar'
import { LibraryPanel } from './ui/LibraryPanel'
import { ResizeHandle } from './ui/ResizeHandle'
import { GroupDialog } from './ui/GroupDialog'
import { Toast } from './ui/Toast'
import { useUiStore } from './state/uiStore'

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
