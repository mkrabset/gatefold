import { useEffect } from 'react'
import { Canvas } from './editor/Canvas'
import { Toolbar } from './ui/Toolbar'
import { Sidebar } from './ui/Sidebar'
import { LibraryPanel } from './ui/LibraryPanel'
import { useUiStore } from './state/uiStore'

export default function App() {
  const theme = useUiStore((s) => s.theme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  return (
    <div className="app">
      <Toolbar />
      <div className="main">
        <Sidebar />
        <Canvas />
        <LibraryPanel />
      </div>
    </div>
  )
}
