import { useEditorStore } from '../state/editorStore'

/**
 * Confirmation dialog shown before deleting a library template. Renders nothing
 * while `pendingDelete` is null.
 */
export function DeleteDialog() {
  const pendingDelete = useEditorStore((s) => s.pendingDelete)
  const design = useEditorStore((s) => s.design)
  const confirmDeleteTemplate = useEditorStore((s) => s.confirmDeleteTemplate)
  const cancelDeleteTemplate = useEditorStore((s) => s.cancelDeleteTemplate)

  if (!pendingDelete) return null
  const name = design.defs[pendingDelete]?.name ?? pendingDelete

  return (
    <div className="dialog-overlay" onClick={cancelDeleteTemplate}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">Delete component</div>
        <div className="dialog-text">Do you really want to delete component "{name}"?</div>
        <div className="dialog-actions">
          <button className="dialog-btn" onClick={cancelDeleteTemplate}>No</button>
          <button className="dialog-btn danger" onClick={confirmDeleteTemplate}>Yes</button>
        </div>
      </div>
    </div>
  )
}
