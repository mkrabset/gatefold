import { useState } from 'react'
import { isTemplateDef, templateCategories, templateCategory } from '@gatefold/model'
import { useEditorStore } from '../state/editorStore'

/**
 * Confirmation dialog shown before clearing parts of the design. It lists a checkbox for
 * the component tree (the root sheet) and one per library category — "All" (the whole
 * library), "Uncategorized", and each user-defined category — so the user can pick what
 * to delete. "All" is a master toggle that disables the per-category checkboxes.
 * Mounted only while `pendingClearAll` is true, so its checkbox state starts fresh each
 * time (everything checked).
 */
export function ClearAllDialog() {
  const design = useEditorStore((s) => s.design)
  const confirmClearAll = useEditorStore((s) => s.confirmClearAll)
  const cancelClearAll = useEditorStore((s) => s.cancelClearAll)

  const categories = templateCategories(design)
  const [tree, setTree] = useState(true)
  const [all, setAll] = useState(true)
  const [cats, setCats] = useState<Set<string>>(() => new Set(categories))

  const toggleCat = (c: string) =>
    setCats((prev) => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c)
      else next.add(c)
      return next
    })

  const templateIds = Object.values(design.library)
    .filter((d) => isTemplateDef(design, d))
    .filter((d) => all || cats.has(templateCategory(d)))
    .map((d) => d.id)

  const nothingSelected = !tree && templateIds.length === 0

  return (
    <div className="dialog-overlay" onClick={cancelClearAll}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">Delete everything?</div>
        <div className="dialog-text">Choose what to delete. This cannot be undone.</div>

        <div className="dialog-section">
          <div className="dialog-section-title">Design</div>
          <label className="dialog-check">
            <input type="checkbox" checked={tree} onChange={(e) => setTree(e.target.checked)} />
            <span>Component tree</span>
          </label>
        </div>

        <div className="dialog-section">
          <div className="dialog-section-title">Library</div>
          <label className="dialog-check">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            <span>All components</span>
          </label>
          {categories.map((c) => (
            <label key={c} className={`dialog-check${all ? ' disabled' : ''}`}>
              <input type="checkbox" disabled={all} checked={all || cats.has(c)} onChange={() => toggleCat(c)} />
              <span>{c}</span>
            </label>
          ))}
        </div>

        <div className="dialog-actions">
          <button className="dialog-btn" onClick={cancelClearAll}>No</button>
          <button
            className="dialog-btn danger"
            disabled={nothingSelected}
            onClick={() => confirmClearAll({ tree, templateIds })}
          >
            Yes
          </button>
        </div>
      </div>
    </div>
  )
}
