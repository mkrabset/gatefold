import { useState } from 'react'
import { PRIMITIVE_LIBRARY } from '@logica/model'
import { useEditorStore } from '../state/editorStore'

/**
 * Right panel: a palette of placeable primitives plus the user's composite
 * components (derived from the design's definitions). Selecting a card is currently
 * cosmetic — placement itself is not implemented yet.
 */

export function LibraryPanel({ width }: { width: number }) {
  const [active, setActive] = useState<string | null>(null)
  const design = useEditorStore((s) => s.design)
  const composites = Object.values(design.defs).filter((d) => d.kind === 'composite' && d.id !== design.root)

  return (
    <aside className="library" style={{ width }}>
      <div className="side-title">Library</div>
      <div className="lib-section-label">Primitives</div>
      <div className="lib-grid">
        {PRIMITIVE_LIBRARY.map((p) => (
          <button
            key={p.kind}
            className={`lib-card${active === p.kind ? ' active' : ''}`}
            onClick={() => setActive(p.kind)}
            title={`Place ${p.label}`}
          >
            <span className="lib-glyph">{p.glyph}</span>
            <span className="lib-label">{p.label}</span>
          </button>
        ))}
      </div>
      {composites.length > 0 && (
        <>
          <div className="lib-section-label">My components</div>
          <div className="lib-grid">
            {composites.map((d) => (
              <button key={d.id} className={`lib-card${active === d.id ? ' active' : ''}`} title={`Place ${d.name}`} onClick={() => setActive(d.id)}>
                <span className="lib-glyph">▣</span>
                <span className="lib-label">{d.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </aside>
  )
}
