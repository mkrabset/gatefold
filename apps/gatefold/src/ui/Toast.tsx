import { useEffect } from 'react'
import { useEditorStore } from '../state/editorStore'

/**
 * Transient message (e.g. "Input already has a driver"). Shows while `notice` is set
 * and auto-dismisses after a couple of seconds.
 */
export function Toast() {
  const notice = useEditorStore((s) => s.notice)
  const clearNotice = useEditorStore((s) => s.clearNotice)

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(clearNotice, 2000)
    return () => clearTimeout(t)
  }, [notice, clearNotice])

  if (!notice) return null
  return <div className="toast">{notice}</div>
}
