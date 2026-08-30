import { useRef, useState } from 'react'
import { libraryPrimitives, isTemplateDef } from '@gatefold/model'
import { useEditorStore } from '../state/editorStore'
import { useSimStore } from '../state/simStore'
import { useUiStore } from '../state/uiStore'
import { darkPalette, lightPalette } from '../editor/palette'

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
  const design = useEditorStore((s) => s.design)
  const navStack = useEditorStore((s) => s.navStack)
  const navigateTo = useEditorStore((s) => s.navigateTo)
  const requestDeleteTemplate = useEditorStore((s) => s.requestDeleteTemplate)
  const exportLibrary = useEditorStore((s) => s.exportLibrary)
  const importLibrary = useEditorStore((s) => s.importLibrary)
  const applyTemplateToInstances = useEditorStore((s) => s.applyTemplateToInstances)
  const simulating = useSimStore((s) => s.mode) === 'simulate'
  const fileRef = useRef<HTMLInputElement>(null)
  const composites = Object.values(design.defs).filter((d) => d.kind === 'composite' && d.id !== design.root && !d.variant)
  const activeDef = active ? design.defs[active] : null
  const activeTemplate = activeDef && isTemplateDef(design, activeDef) ? active : null

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
        {activeTemplate && (
          <button className="lib-action" onClick={() => applyTemplateToInstances(activeTemplate)} title="Apply this template's changes to matching instances in the current scope">
            Apply to instances
          </button>
        )}
        <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onImportFile} />
      </div>
      {composites.length > 0 && (
        <div className="lib-components">
          <div className="lib-grid">
            {composites.map((d) => {
              const editing = navStack.includes(d.id)
              return (
                <button
                  key={d.id}
                  className={`lib-card${active === d.id ? ' active' : ''}${editing ? ' editing' : ''}`}
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
                  <span className="lib-glyph">▣</span>
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
