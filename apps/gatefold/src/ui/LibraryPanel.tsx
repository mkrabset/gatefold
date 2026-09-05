import { useRef, useState } from 'react'
import { libraryPrimitives, isTemplateDef, templateCategory, UNCATEGORIZED } from '@gatefold/model'
import type { CompositeDef } from '@gatefold/model'
import { useEditorStore } from '../state/editorStore'
import { useSimStore } from '../state/simStore'
import { useUiStore } from '../state/uiStore'
import { darkPalette, lightPalette } from '../editor/palette'
import { PRIMITIVE_ICONS } from '../icons'

/**
 * Right panel: a palette of placeable primitives plus the user's composite
 * components (derived from the design's definitions). Drag a card to place a copy;
 * double-click a composite card to edit its template; import/export the custom
 * component library as JSON.
 */

/** A filled-circle drag image, sized to match the dropped NODE dot (`radius = 4·zoom`). */
function joinpointDragImage(diameter: number, color: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = diameter
  const ctx = canvas.getContext('2d')!
  ctx.beginPath()
  ctx.arc(diameter / 2, diameter / 2, diameter / 2, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  return canvas
}

export function LibraryPanel({ width }: { width: number }) {
  const [active, setActive] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('All')
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const design = useEditorStore((s) => s.design)
  const navStack = useEditorStore((s) => s.navStack)
  const navigateTo = useEditorStore((s) => s.navigateTo)
  const requestDeleteTemplate = useEditorStore((s) => s.requestDeleteTemplate)
  const exportLibrary = useEditorStore((s) => s.exportLibrary)
  const importLibrary = useEditorStore((s) => s.importLibrary)
  const applyTemplateToInstances = useEditorStore((s) => s.applyTemplateToInstances)
  const setDefCategory = useEditorStore((s) => s.setDefCategory)
  const simulating = useSimStore((s) => s.mode) === 'simulate'
  const fileRef = useRef<HTMLInputElement>(null)
  const composites = Object.values(design.library).filter((d): d is CompositeDef => isTemplateDef(design, d))
  const activeDef = active ? design.library[active] : null
  const activeTemplate = activeDef && isTemplateDef(design, activeDef) ? active : null

  // Distinct categories across the templates, sorted; "All" shows every component.
  const categories = [...new Set(composites.map((d) => templateCategory(d)))].sort()
  const effectiveFilter = filter !== 'All' && !categories.includes(filter) ? 'All' : filter
  const visible = effectiveFilter === 'All' ? composites : composites.filter((d) => templateCategory(d) === effectiveFilter)

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    importLibrary(await file.text())
    e.target.value = ''
  }

  const createCategory = () => {
    const name = draft.trim()
    if (name && activeTemplate) {
      setDefCategory(activeTemplate, name)
      setFilter(name)
    }
    setDraft('')
    setCreating(false)
  }

  const activeCategory = activeTemplate ? templateCategory(activeDef as CompositeDef) : UNCATEGORIZED

  return (
    <aside className="library" style={{ width }}>
      <div className="side-title">Library</div>
      <div className="lib-section-label">Primitives</div>
      <div className="lib-grid">
        {libraryPrimitives().map((p) => (
          <button
            key={p.kind}
            className={`lib-card${active === p.kind ? ' active' : ''}`}
            draggable={!simulating}
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-gatefold-def', p.kind)
              if (p.kind === 'join-point') {
                // Show the NODE as the filled dot it becomes on drop, sized to the
                // current zoom (radius 4 world units → 4·zoom screen px).
                const zoom = useEditorStore.getState().viewport.zoom
                const diameter = Math.max(2, Math.ceil(8 * zoom))
                const theme = useUiStore.getState().theme
                const img = joinpointDragImage(diameter, (theme === 'dark' ? darkPalette : lightPalette).wire)
                img.style.position = 'fixed'
                img.style.left = img.style.top = '-9999px'
                document.body.appendChild(img)
                e.dataTransfer.setDragImage(img, diameter / 2, diameter / 2)
                setTimeout(() => img.remove(), 0)
              }
            }}
            onClick={() => setActive(p.kind)}
            title={`Drag to place ${p.label}`}
          >
            <img className="lib-icon" src={PRIMITIVE_ICONS[p.kind]} alt={p.label} draggable={false} />
            <span className="lib-label">{p.label}</span>
          </button>
        ))}
      </div>
      <div className="lib-section-label">My components</div>
      <div className="lib-filter">
        <select value={effectiveFilter} onChange={(e) => setFilter(e.target.value)} title="Show one category at a time">
          <option value="All">All</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="lib-actions">
        <button className="lib-action" onClick={exportLibrary} title="Export the component library as JSON" disabled={composites.length === 0}>
          Export
        </button>
        <button className="lib-action" onClick={() => fileRef.current?.click()} title="Import components from JSON">
          Import
        </button>
        {activeTemplate && (
          <button className="lib-action" onClick={() => applyTemplateToInstances(activeTemplate)} title="Apply this template's changes to matching instances in the current scope">
            Apply to instances
          </button>
        )}
        <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onImportFile} />
      </div>
      {activeTemplate && (
        <div className="lib-category-row">
          {creating ? (
            <input
              className="lib-category-input"
              value={draft}
              placeholder="New category name"
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  createCategory()
                } else if (e.key === 'Escape') {
                  setCreating(false)
                  setDraft('')
                }
              }}
              onBlur={createCategory}
            />
          ) : (
            <select
              className="lib-category-select"
              value={activeCategory}
              onChange={(e) => {
                const v = e.target.value
                if (v === '__new__') setCreating(true)
                else setDefCategory(activeTemplate, v)
              }}
              title="Move this component to a category"
            >
              <option value={UNCATEGORIZED}>{UNCATEGORIZED}</option>
              {categories
                .filter((c) => c !== UNCATEGORIZED)
                .map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              <option value="__new__">＋ New category…</option>
            </select>
          )}
        </div>
      )}
      {composites.length > 0 && (
        <div className="lib-components">
          <div className="lib-grid">
            {visible.map((d) => {
              const editing = navStack.includes(d.id)
              return (
                <button
                  key={d.id}
                  className={`lib-card compact${active === d.id ? ' active' : ''}${editing ? ' editing' : ''}`}
                  draggable={!simulating}
                  onDragStart={(e) => e.dataTransfer.setData('application/x-gatefold-def', d.id)}
                  onClick={() => setActive(d.id)}
                  onDoubleClick={() => {
                    if (!simulating) navigateTo(d.id)
                  }}
                  title={editing ? `Editing ${d.name}` : `Drag to place · double-click to edit ${d.name}`}
                >
                  <span
                    className={`lib-remove${editing ? ' disabled' : ''}`}
                    title={editing ? "You're editing this component" : `Delete ${d.name}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (!editing) requestDeleteTemplate(d.id)
                    }}
                  >
                    ×
                  </span>
                  <span className="lib-label">{d.name}</span>
                  {editing && <span className="lib-editing">editing</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </aside>
  )
}
