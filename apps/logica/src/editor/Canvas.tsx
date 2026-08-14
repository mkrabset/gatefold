import { useEffect, useRef } from 'react'
import { currentDefId, useEditorStore } from '../state/editorStore'
import { useUiStore } from '../state/uiStore'
import { hitTest } from './geometry'
import { drawScene } from './renderer'
import { darkPalette, lightPalette } from './palette'
import type { Viewport } from '../state/editorStore'

type Drag =
  | { type: 'pan'; startX: number; startY: number; vp: Viewport }
  | { type: 'move'; id: string; startX: number; startY: number; orig: { x: number; y: number } }

const MIN_ZOOM = 0.15
const MAX_ZOOM = 4

export function Canvas() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const wrap = wrapRef.current!
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!

    const draw = () => {
      const state = useEditorStore.getState()
      const theme = useUiStore.getState().theme
      const palette = theme === 'dark' ? darkPalette : lightPalette
      const cw = wrap.clientWidth
      const ch = wrap.clientHeight
      drawScene(ctx, cw, ch, state.design, state.viewport, state.selectedId, currentDefId(state), palette)
    }

    const resize = () => {
      const rect = wrap.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      draw()
    }

    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    resize()
    const unsub = useEditorStore.subscribe(draw)
    const unsubTheme = useUiStore.subscribe(draw)

    let drag: Drag | null = null

    const toWorld = (sx: number, sy: number) => {
      const { viewport } = useEditorStore.getState()
      const rect = wrap.getBoundingClientRect()
      return {
        x: viewport.x + (sx - rect.width / 2) / viewport.zoom,
        y: viewport.y + (sy - rect.height / 2) / viewport.zoom,
      }
    }

    const onPointerDown = (e: PointerEvent) => {
      const rect = wrap.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      const w = toWorld(sx, sy)
      const state = useEditorStore.getState()
      const def = state.design.defs[currentDefId(state)]
      const hit = hitTest(w.x, w.y, def.instances ?? [], state.design.defs)

      if (hit) {
        useEditorStore.getState().select(hit.id)
        drag = { type: 'move', id: hit.id, startX: e.clientX, startY: e.clientY, orig: { ...hit.pos } }
        canvas.style.cursor = 'grabbing'
      } else {
        useEditorStore.getState().select(null)
        drag = { type: 'pan', startX: e.clientX, startY: e.clientY, vp: { ...state.viewport } }
        canvas.style.cursor = 'grabbing'
      }
      canvas.setPointerCapture(e.pointerId)
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!drag) return
      const state = useEditorStore.getState()
      if (drag.type === 'pan') {
        const dx = e.clientX - drag.startX
        const dy = e.clientY - drag.startY
        state.setViewport({
          x: drag.vp.x - dx / drag.vp.zoom,
          y: drag.vp.y - dy / drag.vp.zoom,
          zoom: drag.vp.zoom,
        })
      } else {
        const dx = e.clientX - drag.startX
        const dy = e.clientY - drag.startY
        state.moveInstance(drag.id, {
          x: drag.orig.x + dx / state.viewport.zoom,
          y: drag.orig.y + dy / state.viewport.zoom,
        })
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      drag = null
      canvas.style.cursor = 'default'
      canvas.releasePointerCapture(e.pointerId)
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const state = useEditorStore.getState()
      const vp = state.viewport
      const factor = Math.pow(1.0015, -e.deltaY)
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, vp.zoom * factor))
      const rect = wrap.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const w0x = vp.x + (mx - rect.width / 2) / vp.zoom
      const w0y = vp.y + (my - rect.height / 2) / vp.zoom
      state.setViewport({
        x: w0x - (mx - rect.width / 2) / zoom,
        y: w0y - (my - rect.height / 2) / zoom,
        zoom,
      })
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      ro.disconnect()
      unsub()
      unsubTheme()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('wheel', onWheel)
    }
  }, [])

  return (
    <div ref={wrapRef} className="canvas-area">
      <canvas ref={canvasRef} className="canvas" />
    </div>
  )
}
