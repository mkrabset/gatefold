import { useEditorStore } from '../state/editorStore'

/**
 * Modal shown after clicking "Group". Lists the inferred input/output ports with
 * editable names; "Create" commits the transformation via `confirmGroup`. Renders
 * nothing while `pendingGroup` is null.
 */

export function GroupDialog() {
  const pendingGroup = useEditorStore((s) => s.pendingGroup)
  const setGroupName = useEditorStore((s) => s.setGroupName)
  const setGroupInputName = useEditorStore((s) => s.setGroupInputName)
  const setGroupOutputName = useEditorStore((s) => s.setGroupOutputName)
  const confirmGroup = useEditorStore((s) => s.confirmGroup)
  const cancelGroup = useEditorStore((s) => s.cancelGroup)

  if (!pendingGroup) return null

  return (
    <div className="dialog-overlay" onClick={cancelGroup}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">{pendingGroup.promote ? 'Save as template' : 'Group into component'}</div>
        <div className="dialog-section">
          <div className="dialog-section-title">Name</div>
          <input
            className="dialog-input"
            value={pendingGroup.name}
            onChange={(e) => setGroupName(e.target.value)}
            autoFocus
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
          <button className="dialog-btn" onClick={cancelGroup}>Cancel</button>
          <button className="dialog-btn primary" onClick={confirmGroup}>
            {pendingGroup.promote ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
