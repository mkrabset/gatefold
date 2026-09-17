import { useState } from 'react'
import { templateCategories } from '@gatefold/model'
import { useEditorStore } from '../state/editorStore'
import { useAutoFocus, useEscapeToClose } from './useDialog'

/**
 * Confirmation dialog shown before deleting library components by category. It lists a
 * checkbox for every category (including "Uncategorized") plus a "Select all" master
 * toggle, so the user can delete the whole library or just chosen categories. Mounted
 * only while `pendingCategoryDelete` is true, so its checkbox state starts fresh each
 * time (everything checked).
 */
export function DeleteCategoriesDialog() {
  const design = useEditorStore((s) => s.design)
  const confirmCategoryDelete = useEditorStore((s) => s.confirmCategoryDelete)
  const cancelCategoryDelete = useEditorStore((s) => s.cancelCategoryDelete)
  const deleteRef = useAutoFocus<HTMLButtonElement>()
  useEscapeToClose(cancelCategoryDelete)

  const categories = templateCategories(design)
  const [all, setAll] = useState(true)
  const [cats, setCats] = useState<Set<string>>(() => new Set(categories))

  const toggleCat = (c: string) =>
    setCats((prev) => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c)
      else next.add(c)
      return next
    })

  const selected = all ? categories : categories.filter((c) => cats.has(c))
  const nothingSelected = selected.length === 0

  return (
    <div className="dialog-overlay" onClick={cancelCategoryDelete}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">Delete components</div>
        <div className="dialog-text">Choose which categories to delete. This cannot be undone.</div>

        <div className="dialog-section">
          <label className="dialog-check">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            <span>Select all</span>
          </label>
        </div>

        <div className="dialog-section">
          <div className="dialog-section-title">Categories</div>
          <div className="dialog-cat-list">
            {categories.map((c) => (
              <label key={c} className={`dialog-check${all ? ' disabled' : ''}`}>
                <input type="checkbox" disabled={all} checked={all || cats.has(c)} onChange={() => toggleCat(c)} />
                <span>{c}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="dialog-actions">
          <button className="dialog-btn" onClick={cancelCategoryDelete}>Cancel</button>
          <button
            ref={deleteRef}
            className="dialog-btn danger"
            disabled={nothingSelected}
            onClick={() => confirmCategoryDelete(selected)}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
