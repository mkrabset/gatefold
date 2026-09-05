import { useEffect, useRef } from 'react'
import type { PendingGroup } from '../state/editorStore'
import { useEditorStore } from '../state/editorStore'

/**
 * Modal shown after clicking "Group". Lists the inferred input/output ports with
 * editable names; "Create" commits the transformation via `confirmGroup`. Renders
 * nothing while `pendingGroup` is null. The inner `GroupForm` mounts only when the
 * dialog opens, so its focus effect runs fresh each time.
 */
export function GroupDialog() {
  const pendingGroup = useEditorStore((s) => s.pendingGroup)
  if (!pendingGroup) return null
  return <GroupForm pendingGroup={pendingGroup} />
}

function GroupForm({ pendingGroup }: { pendingGroup: PendingGroup }) {
  const setGroupName = useEditorStore((s) => s.setGroupName)
  const setGroupInputName = useEditorStore((s) => s.setGroupInputName)
  const setGroupOutputName = useEditorStore((s) => s.setGroupOutputName)
  const confirmGroup = useEditorStore((s) => s.confirmGroup)
  const cancelGroup = useEditorStore((s) => s.cancelGroup)
  const nameRef = useRef<HTMLInputElement>(null)

  // Focus the name field (with the inferred name selected) so typing replaces it.
  // Deferred past the toolbar button's click gesture, whose mouse-up/click would
  // otherwise move focus back to the button.
  useEffect(() => {
    const el = nameRef.current
    if (!el) return
    const t = setTimeout(() => {
      el.focus()
      el.select()
    }, 0)
    return () => clearTimeout(t)
  }, [])

  return (
    <div
      className="dialog-overlay"
      onClick={cancelGroup}
      onMouseDown={(e) => {
        // Clicking the backdrop (which closes the dialog anyway) must not steal focus
        // from the name field; leave the inputs/buttons inside alone.
        if (e.target === e.currentTarget) e.preventDefault()
      }}
    >
      <form
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          confirmGroup()
        }}
      >
        <div className="dialog-title">{pendingGroup.promote ? 'Save as template' : 'Group into component'}</div>
        <div className="dialog-section">
          <div className="dialog-section-title">Name</div>
          <input
            ref={nameRef}
            className="dialog-input"
            value={pendingGroup.name}
            onChange={(e) => setGroupName(e.target.value)}
          />
        </div>
        {!pendingGroup.promote && (
          <>
            <div className="dialog-section">
              <div className="dialog-section-title">Inputs</div>
              {pendingGroup.inputs.map((name, i) => (
                <input
                  key={`in-${i}`}
                  className="dialog-input"
                  value={name}
                  onChange={(e) => setGroupInputName(i, e.target.value)}
                />
              ))}
              {pendingGroup.inputs.length === 0 && <div className="dialog-empty">no inputs</div>}
            </div>
            <div className="dialog-section">
              <div className="dialog-section-title">Outputs</div>
              {pendingGroup.outputs.map((name, i) => (
                <input
                  key={`out-${i}`}
                  className="dialog-input"
                  value={name}
                  onChange={(e) => setGroupOutputName(i, e.target.value)}
                />
              ))}
              {pendingGroup.outputs.length === 0 && <div className="dialog-empty">no outputs</div>}
            </div>
          </>
        )}
        <div className="dialog-actions">
          <button type="button" className="dialog-btn" onClick={cancelGroup}>Cancel</button>
          <button type="submit" className="dialog-btn primary">
            {pendingGroup.promote ? 'Save' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  )
}
