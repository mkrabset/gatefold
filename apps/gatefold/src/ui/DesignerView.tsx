import { LIBRARY_KINDS } from '@gatefold/model'
import { Canvas } from '../editor/Canvas'
import { useEditorStore } from '../state/editorStore'
import { useSimStore } from '../state/simStore'
import { PrimitivePalette } from './PrimitivePalette'

/**
 * The "Designer" tab: the horizontal primitive strip above the schematic canvas.
 * Dragging a card places a copy on the canvas below.
 */
export function DesignerView() {
  const simulating = useSimStore((s) => s.mode) === 'simulate'
  return (
    <div className="canvas-view">
      <PrimitivePalette
        kinds={LIBRARY_KINDS}
        simulating={simulating}
        zoomOf={() => useEditorStore.getState().viewport.zoom}
      />
      <Canvas />
    </div>
  )
}
