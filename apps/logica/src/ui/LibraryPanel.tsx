import { useState } from 'react'
import { PRIMITIVE_LIBRARY } from '@logica/model'

export function LibraryPanel() {
  const [active, setActive] = useState<string | null>(null)

  return (
    <aside className="library">
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
      <div className="lib-section-label">My components</div>
      <div className="lib-grid">
        <button className={`lib-card${active === 'half-adder' ? ' active' : ''}`} onClick={() => setActive('half-adder')}>
          <span className="lib-glyph">▣</span>
          <span className="lib-label">half-adder</span>
        </button>
      </div>
    </aside>
  )
}
