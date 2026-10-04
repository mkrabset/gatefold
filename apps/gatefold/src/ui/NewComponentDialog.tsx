import { useEffect, useRef, useState } from 'react'
import { useEditorStore } from '../state/editorStore'
import { useEscapeToClose } from './useDialog'

/**
 * Modal shown after clicking the toolbar's "+" (New component). Asks for a name and, on
 * "Create", places a new empty composite on the canvas (not yet in the library). Renders
 * nothing while `pendingNewComponent` is false.
 */
export function NewComponentDialog() {
  const open = useEditorStore((s) => s.pendingNewComponent)
  const closeNewComponentDialog = useEditorStore((s) => s.closeNewComponentDialog)
  const confirmNewComponent = useEditorStore((s) => s.confirmNewComponent)
  const [name, setName] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  useEscapeToClose(closeNewComponentDialog, open)

  // Focus the name field (selected) so typing replaces it, deferred past the toolbar
  // button's click gesture.
  useEffect(() => {
    if (!open) return
    setName('')
    const t = setTimeout(() => {
      nameRef.current?.focus()
      nameRef.current?.select()
    }, 0)
    return () => clearTimeout(t)
  }, [open])

  if (!open) return null

  const submit = () => {
    confirmNewComponent(name)
  }

  return (
    <div className="dialog-overlay" onClick={closeNewComponentDialog}>
      <form
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="dialog-title">New component</div>
        <div className="dialog-section">
          <div className="dialog-section-title">Name</div>
          <input
            ref={nameRef}
            className="dialog-input"
            placeholder="component"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="dialog-actions">
          <button type="button" className="dialog-btn" onClick={closeNewComponentDialog}>
            Cancel
          </button>
          <button type="submit" className="dialog-btn primary">
            Create
          </button>
        </div>
      </form>
    </div>
  )
}
