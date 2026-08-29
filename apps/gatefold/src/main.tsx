import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { useEditorStore } from './state/editorStore'
import { decodeDesignLink } from './util/link'

// Entry point: mounts the app into #root (see index.html). If the URL carries a `?d=`
// share link, decode it and load that design in place of the stored default.
async function bootstrap(): Promise<void> {
  const root = document.getElementById('root')!
  const json = await decodeDesignLink(window.location.search)
  if (json) {
    useEditorStore.getState().loadProject(json)
  }
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
