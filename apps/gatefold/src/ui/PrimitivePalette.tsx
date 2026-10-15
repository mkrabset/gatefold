import type { PrimitiveKind } from '@gatefold/model'
import { primitiveOf } from '@gatefold/model'
import { PRIMITIVE_ICONS } from '../icons'
import { useUiStore } from '../state/uiStore'
import { darkPalette, lightPalette } from '../editor/palette'

/**
 * A horizontal strip of draggable primitive cards, shared by the Designer and Testing
 * canvases. Dragging sets the same `application/x-gatefold-def` payload the canvas drop
 * handlers expect (a primitive kind).
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

export function PrimitivePalette({
  kinds,
  simulating,
  hint,
  zoomOf,
}: {
  kinds: PrimitiveKind[]
  simulating: boolean
  hint?: string
  zoomOf?: () => number
}) {
  return (
    <div className="palette-strip">
      {kinds.map((kind) => {
        const prim = primitiveOf(kind)
        return (
          <button
            key={kind}
            className="palette-item"
            draggable={!simulating}
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-gatefold-def', kind)
              if (kind === 'join-point' && zoomOf) {
                // Show the NODE as the filled dot it becomes on drop, sized to the
                // current zoom (radius 4 world units → 4·zoom screen px).
                const diameter = Math.max(2, Math.ceil(8 * zoomOf()))
                const theme = useUiStore.getState().theme
                const img = joinpointDragImage(diameter, (theme === 'dark' ? darkPalette : lightPalette).wire)
                img.style.position = 'fixed'
                img.style.left = img.style.top = '-9999px'
                document.body.appendChild(img)
                e.dataTransfer.setDragImage(img, diameter / 2, diameter / 2)
                setTimeout(() => img.remove(), 0)
              }
            }}
            title={`Drag to place ${prim.label}`}
          >
            {PRIMITIVE_ICONS[kind] ? (
              <img className="lib-icon" src={PRIMITIVE_ICONS[kind]} alt={prim.label} draggable={false} />
            ) : (
              <span className="lib-glyph">{prim.glyph}</span>
            )}
            <span className="lib-label">{prim.label}</span>
          </button>
        )
      })}
      {hint && <span className="palette-hint">{hint}</span>}
    </div>
  )
}
