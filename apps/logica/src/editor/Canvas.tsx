import { useEffect, useRef } from 'react'
import { currentDefId, useEditorStore } from '../state/editorStore'
import { useUiStore } from '../state/uiStore'
import { hitTest, instanceBounds } from './geometry'
import { drawScene } from './renderer'
import { darkPalette, lightPalette } from './palette'
import type { Viewport } from '../state/editorStore'

type Drag =
  | { type: 'pan'; startX: number; startY: number; vp: Viewport }
  | { type: 'move'; ids: string[]; startX: number; startY: number; origins: { x: number; y: number }[] }
  | { type: 'marquee'; startX: number; startY: number; startWorld: { x: number; y: number } }
  | { type: 'shiftClick'; id: string; startX: number; startY: number; vp: Viewport }

const MIN_ZOOM = 0.15
const MAX_ZOOM = 4
const DRAG_THRESHOLD = 4

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
      drawScene(ctx, cw, ch, state.design, state.viewport, state.selectedIds, currentDefId(state), state.marquee, palette)
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

    const currentInstances = () => {
      const state = useEditorStore.getState()
      return state.design.defs[currentDefId(state)].instances ?? []
    }

    const onPointerDown = (e: PointerEvent) => {
      const state = useEditorStore.getState()
      const rect = wrap.getBoundingClientRect()
      const w = toWorld(e.clientX - rect.left, e.clientY - rect.top)
      const instances = currentInstances()
      const hit = hitTest(w.x, w.y, instances, state.design.defs)

      if (e.shiftKey) {
        if (hit) {
          drag = { type: 'shiftClick', id: hit.id, startX: e.clientX, startY: e.clientY, vp: { ...state.viewport } }
        } else {
          drag = { type: 'pan', startX: e.clientX, startY: e.clientY, vp: { ...state.viewport } }
          canvas.style.cursor = 'grabbing'
        }
        canvas.setPointerCapture(e.pointerId)
        return
      }

      if (hit) {
        const selected = state.selectedIds.includes(hit.id)
        const ids = selected ? state.selectedIds : [hit.id]
        const byId = new Map(instances.map((i) => [i.id, i]))
        const origins = ids.map((id) => ({ ...byId.get(id)!.pos }))
        if (!selected) {
          state.setSelection([hit.id])
        }
        drag = { type: 'move', ids, startX: e.clientX, startY: e.clientY, origins }
        canvas.style.cursor = 'grabbing'
        canvas.setPointerCapture(e.pointerId)
      } else {
        state.setSelection([])
        drag = { type: 'marquee', startX: e.clientX, startY: e.clientY, startWorld: w }
        canvas.style.cursor = 'crosshair'
        canvas.setPointerCapture(e.pointerId)
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      const d = drag
      if (!d) return
      const state = useEditorStore.getState()

      switch (d.type) {
        case 'pan': {
          const dx = e.clientX - d.startX
          const dy = e.clientY - d.startY
          state.setViewport({
            x: d.vp.x - dx / d.vp.zoom,
            y: d.vp.y - dy / d.vp.zoom,
            zoom: d.vp.zoom,
          })
          return
        }
        case 'shiftClick': {
          if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > DRAG_THRESHOLD) {
            drag = { type: 'pan', startX: d.startX, startY: d.startY, vp: d.vp }
            canvas.style.cursor = 'grabbing'
          }
          return
        }
        case 'move': {
          const dx = (e.clientX - d.startX) / state.viewport.zoom
          const dy = (e.clientY - d.startY) / state.viewport.zoom
          const positions = d.ids.map((_, i) => ({ x: d.origins[i].x + dx, y: d.origins[i].y + dy }))
          state.setInstancesPosition(d.ids, positions)
          return
        }
        case 'marquee': {
          const rect = wrap.getBoundingClientRect()
          const cur = toWorld(e.clientX - rect.left, e.clientY - rect.top)
          const x0 = Math.min(d.startWorld.x, cur.x)
          const x1 = Math.max(d.startWorld.x, cur.x)
          const y0 = Math.min(d.startWorld.y, cur.y)
          const y1 = Math.max(d.startWorld.y, cur.y)
          state.setMarquee({ x0, y0, x1, y1 })
          const instances = currentInstances()
          const selected = instances
            .filter((inst) => {
              const b = instanceBounds(inst, state.design.defs[inst.defId])
              return b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0
            })
            .map((inst) => inst.id)
          state.setSelection(selected)
        }
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      if (drag?.type === 'shiftClick') {
        useEditorStore.getState().toggleSelected(drag.id)
      }
      if (drag?.type === 'marquee') {
        useEditorStore.getState().setMarquee(null)
      }
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
