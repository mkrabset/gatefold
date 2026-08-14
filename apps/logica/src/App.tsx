import { useEffect } from 'react'
import { Canvas } from './editor/Canvas'
import { Toolbar } from './ui/Toolbar'
import { Sidebar } from './ui/Sidebar'
import { LibraryPanel } from './ui/LibraryPanel'
import { ResizeHandle } from './ui/ResizeHandle'
import { useUiStore } from './state/uiStore'

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
        <ResizeHandle value={sidebarWidth} min={160} max={480} direction={1} onChange={setSidebarWidth} />
        <Canvas />
        <ResizeHandle value={libraryWidth} min={140} max={400} direction={-1} onChange={setLibraryWidth} />
        <LibraryPanel width={libraryWidth} />
      </div>
    </div>
  )
}
