import { useRef, useState } from 'react'
import { PRIMITIVE_LIBRARY } from '@logica/model'
import { useEditorStore } from '../state/editorStore'

/**
 * Right panel: a palette of placeable primitives plus the user's composite
 * components (derived from the design's definitions). Drag a card to place a copy;
 * double-click a composite card to edit its template; import/export the custom
 * component library as JSON.
 */

export function LibraryPanel({ width }: { width: number }) {
  const [active, setActive] = useState<string | null>(null)
  const design = useEditorStore((s) => s.design)
  const navigateTo = useEditorStore((s) => s.navigateTo)
  const requestDeleteTemplate = useEditorStore((s) => s.requestDeleteTemplate)
  const exportLibrary = useEditorStore((s) => s.exportLibrary)
  const importLibrary = useEditorStore((s) => s.importLibrary)
  const fileRef = useRef<HTMLInputElement>(null)
  const composites = Object.values(design.defs).filter((d) => d.kind === 'composite' && d.id !== design.root && !d.variant)

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    importLibrary(await file.text())
    e.target.value = ''
  }

  return (
    <aside className="library" style={{ width }}>
      <div className="side-title">Library</div>
      <div className="lib-section-label">Primitives</div>
      <div className="lib-grid">
        {PRIMITIVE_LIBRARY.map((p) => (
          <button
            key={p.kind}
            className={`lib-card${active === p.kind ? ' active' : ''}`}
            draggable
            onDragStart={(e) => e.dataTransfer.setData('application/x-logica-def', p.kind)}
            onClick={() => setActive(p.kind)}
            title={`Drag to place ${p.label}`}
          >
            <span className="lib-glyph">{p.glyph}</span>
            <span className="lib-label">{p.label}</span>
          </button>
        ))}
      </div>
      <div className="lib-section-label">My components</div>
      <div className="lib-actions">
        <button className="lib-action" onClick={exportLibrary} title="Export the component library as JSON" disabled={composites.length === 0}>
          Export
        </button>
        <button className="lib-action" onClick={() => fileRef.current?.click()} title="Import components from JSON">
          Import
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onImportFile} />
      </div>
      {composites.length > 0 && (
        <div className="lib-grid">
          {composites.map((d) => (
            <button
              key={d.id}
              className={`lib-card${active === d.id ? ' active' : ''}`}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('application/x-logica-def', d.id)}
              onClick={() => setActive(d.id)}
              onDoubleClick={() => navigateTo(d.id)}
              title={`Drag to place · double-click to edit ${d.name}`}
            >
              <span
                className="lib-remove"
                title={`Delete ${d.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  requestDeleteTemplate(d.id)
                }}
              >
                ×
              </span>
              <span className="lib-glyph">▣</span>
              <span className="lib-label">{d.name}</span>
            </button>
          ))}
        </div>
      )}
    </aside>
  )
}
