import { useEffect, useRef } from 'react'
import { currentDefId, useEditorStore } from '../state/editorStore'
import { beginMoveTransaction, endMoveTransaction } from '../state/editorStore'
import { useUiStore } from '../state/uiStore'
import { useSimStore, simColorOf, simValueOf, simSignalOf } from '../state/simStore'
import { hitTest, hitTestPort, instanceBounds, hitArrayIndicator, defContentsBounds } from './geometry'
import { drawScene } from './renderer'
import { s2w } from './viewport'
import { darkPalette, lightPalette } from './palette'
import { formatSpeed } from '../util/format'
import type { PinRef } from '@gatefold/model'
import { findConnectionTo, isNavigableDef, isTemplateDef, pinRefEquals } from '@gatefold/model'
import type { Viewport } from '../state/editorStore'

/**
 * The schematic canvas. Owns the `<canvas>` element, its sizing (HiDPI-aware), and
 * all pointer/wheel interaction. Redraws are imperative: the component subscribes to
 * the stores and re-runs `drawScene` on change, avoiding React re-renders during
 * pan/zoom/drag.
 */

/**
 * The active pointer gesture. A single discriminated union drives the interaction
 * state machine; `shiftClick` upgrades to `pan` once the pointer moves past a
 * threshold, which is what lets shift-click toggle selection while shift-drag pans.
 */
type Drag =
  | { type: 'pan'; startX: number; startY: number; vp: Viewport }
  | { type: 'move'; ids: string[]; startX: number; startY: number; origins: { x: number; y: number }[] }
  | { type: 'marquee'; startX: number; startY: number; startWorld: { x: number; y: number } }
  | { type: 'shiftClick'; id: string; startX: number; startY: number; vp: Viewport }
  | { type: 'wire'; from: PinRef; originalId: string | null; originalTo: PinRef | null }

const MIN_ZOOM = 0.15
const MAX_ZOOM = 4
const DRAG_THRESHOLD = 4

/** Viewport that frames the given world-space bounds in a canvas of size (cw × ch). */
function fitViewport(bounds: { x: number; y: number; w: number; h: number }, cw: number, ch: number): Viewport {
  const cx = bounds.x + bounds.w / 2
  const cy = bounds.y + bounds.h / 2
  const zoom = Math.min(cw / bounds.w, ch / bounds.h) * 0.9
  return { x: cx, y: cy, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) }
}

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
      // Editing a template (any non-root, non-variant composite in the nav path).
      const editingTemplate = state.navStack.some((id) => {
        const d = state.design.defs[id]
        return !!d && isTemplateDef(state.design, d)
      })
      const simState = useSimStore.getState()
      const sim = simState.mode === 'simulate' && simState.engine
        ? { colorOf: simColorOf, valueOf: simValueOf, signalOf: simSignalOf, speedLabel: formatSpeed(simState.timeScale) }
        : undefined
      drawScene(ctx, cw, ch, state.design, state.viewport, state.selectedIds, currentDefId(state), editingTemplate, state.marquee, state.pendingWire, state.hoverPort, palette, sim)
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
    const unsubSim = useSimStore.subscribe(draw)

    let drag: Drag | null = null

    // World coordinates place (0,0) at the viewport center; `viewport.x/y` is the
    // world point shown at the center of the canvas. Invert for screen → world.
    const toWorld = (sx: number, sy: number) => {
      const { viewport } = useEditorStore.getState()
      const rect = wrap.getBoundingClientRect()
      return s2w(sx, sy, rect.width, rect.height, viewport)
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
      const def = state.design.defs[currentDefId(state)]
      const hit = hitTest(w.x, w.y, instances, state.design, def)
      state.setHoverPort(null)

      // Simulation mode: no editing — toggle switches, allow shift-drag pan.
      if (useSimStore.getState().mode === 'simulate') {
        if (e.shiftKey) {
          drag = { type: 'pan', startX: e.clientX, startY: e.clientY, vp: { ...state.viewport } }
          canvas.style.cursor = 'grabbing'
          canvas.setPointerCapture(e.pointerId)
          return
        }
        // Toggle a switch-array lane by clicking its indicator circle (not its marker).
        for (const inst of [...instances].reverse()) {
          const instDef = state.design.defs[inst.defId]
          if (!instDef || instDef.primitive !== 'switch-array') continue
          const lane = hitArrayIndicator(w.x, w.y, state.design, def, inst, instDef, state.viewport.zoom)
          if (lane !== null) {
            useSimStore.getState().toggleSwitch(inst.id, lane)
            return
          }
        }
        return
      }

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

      // Pressing an output port always starts a wire — this takes priority over
      // selecting the component the port belongs to.
        const port = hitTestPort(w.x, w.y, instances, state.design, def)
      if (port && port.role === 'source') {
        drag = { type: 'wire', from: port.ref, originalId: null, originalTo: null }
        state.setPendingWire({ from: port.ref, x: w.x, y: w.y })
        canvas.style.cursor = 'crosshair'
        canvas.setPointerCapture(e.pointerId)
        return
      }

      // Pressing an input that already has a wire grabs that wire (to re-target or
      // delete it), instead of selecting the component.
      if (port && port.role === 'sink') {
        const conn = findConnectionTo(def.connections ?? [], port.ref)
        if (conn) {
          drag = { type: 'wire', from: conn.from, originalId: conn.id, originalTo: conn.to }
          state.setPendingWire({ from: conn.from, x: w.x, y: w.y, originalId: conn.id })
          canvas.style.cursor = 'crosshair'
          canvas.setPointerCapture(e.pointerId)
          state.setHoverPort(port.ref)
          return
        }
      }

      if (hit) {
        const selected = state.selectedIds.includes(hit.id)
        const ids = selected ? state.selectedIds : [hit.id]
        const byId = new Map(instances.map((i) => [i.id, i]))
        const origins = ids.map((id) => ({ ...byId.get(id)!.pos }))
        if (!selected) {
          state.setSelection([hit.id])
        }
        // Coalesce the whole drag into a single undo step.
        beginMoveTransaction()
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
      const state = useEditorStore.getState()
      const d = drag

      // Simulation mode: only panning is interactive.
      if (useSimStore.getState().mode === 'simulate') {
        if (d?.type === 'pan') {
          const dx = e.clientX - d.startX
          const dy = e.clientY - d.startY
          state.setViewport({
            x: d.vp.x - dx / d.vp.zoom,
            y: d.vp.y - dy / d.vp.zoom,
            zoom: d.vp.zoom,
          })
        }
        return
      }

      // Idle hover: highlight the terminal marker under the cursor.
      if (!d) {
        const rect = wrap.getBoundingClientRect()
        const w = toWorld(e.clientX - rect.left, e.clientY - rect.top)
        const def = state.design.defs[currentDefId(state)]
        const port = hitTestPort(w.x, w.y, currentInstances(), state.design, def)
        state.setHoverPort(port ? port.ref : null)
        return
      }

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
          // A shift press on a component is ambiguous: it is either a click (toggle
          // selection) or the start of a pan. Resolve it once movement exceeds the
          // threshold; otherwise the toggle happens on pointer-up.
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
          // Normalize to a min/max rect regardless of drag direction.
          const x0 = Math.min(d.startWorld.x, cur.x)
          const x1 = Math.max(d.startWorld.x, cur.x)
          const y0 = Math.min(d.startWorld.y, cur.y)
          const y1 = Math.max(d.startWorld.y, cur.y)
          state.setMarquee({ x0, y0, x1, y1 })
          const instances = currentInstances()
          const def = state.design.defs[currentDefId(state)]
          // Axis-aligned rectangle intersection test against each instance's bounds.
          const selected = instances
            .filter((inst) => {
              const instDef = state.design.defs[inst.defId]
              if (!instDef) return false
              const b = instanceBounds(state.design, def, inst, instDef)
              return b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0
            })
            .map((inst) => inst.id)
          state.setSelection(selected)
          return
        }
        case 'wire': {
          const rect = wrap.getBoundingClientRect()
          const cur = toWorld(e.clientX - rect.left, e.clientY - rect.top)
          state.setPendingWire({ from: d.from, x: cur.x, y: cur.y, originalId: d.originalId ?? undefined })
          // Highlight a sink under the cursor so it's obvious when the wire can be
          // released to connect (or re-target) there.
          const def = state.design.defs[currentDefId(state)]
          const target = hitTestPort(cur.x, cur.y, currentInstances(), state.design, def)
          state.setHoverPort(target && target.role === 'sink' ? target.ref : null)
        }
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      const d = drag
      if (d?.type === 'shiftClick') {
        useEditorStore.getState().toggleSelected(d.id)
      }
      if (d?.type === 'marquee') {
        useEditorStore.getState().setMarquee(null)
      }
      if (d?.type === 'move') {
        // The final position was already applied by the last pointermove; just end
        // the coalescing so subsequent changes record normally.
        endMoveTransaction()
      }
      if (d?.type === 'wire') {
        const state = useEditorStore.getState()
        const rect = wrap.getBoundingClientRect()
        const w = toWorld(e.clientX - rect.left, e.clientY - rect.top)
        const instances = currentInstances()
        const def = state.design.defs[currentDefId(state)]
        const port = hitTestPort(w.x, w.y, instances, state.design, def)

        if (port && port.role === 'sink') {
          if (d.originalTo && pinRefEquals(port.ref, d.originalTo)) {
            // Released back onto the original target — no change.
          } else if (d.originalId) {
            state.retargetConnection(d.originalId, port.ref)
          } else {
            state.addConnection(d.from, port.ref)
          }
        } else if (d.originalId) {
          // Released on empty space — delete the grabbed wire.
          state.removeConnection(d.originalId)
        }
        state.setPendingWire(null)
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
      // Zoom anchored at the cursor: keep the world point under the pointer fixed by
      // recomputing the viewport center after the zoom change.
      const w0x = vp.x + (mx - rect.width / 2) / vp.zoom
      const w0y = vp.y + (my - rect.height / 2) / vp.zoom
      state.setViewport({
        x: w0x - (mx - rect.width / 2) / zoom,
        y: w0y - (my - rect.height / 2) / zoom,
        zoom,
      })
    }

    // Double-click a component on the canvas to enter it (composites and gates alike).
    const onDblClick = (e: MouseEvent) => {
      const state = useEditorStore.getState()
      const rect = wrap.getBoundingClientRect()
      const w = toWorld(e.clientX - rect.left, e.clientY - rect.top)
      const def = state.design.defs[currentDefId(state)]
      const instances = currentInstances()
      // In simulate mode, double-clicking a switch-array indicator just toggles it
      // again (handled on pointerdown); do not enter the array component scope.
      if (useSimStore.getState().mode === 'simulate') {
        for (const inst of [...instances].reverse()) {
          const instDef = state.design.defs[inst.defId]
          if (!instDef || instDef.primitive !== 'switch-array') continue
          if (hitArrayIndicator(w.x, w.y, state.design, def, inst, instDef, state.viewport.zoom) !== null) {
            return
          }
        }
      }
      const hit = hitTest(w.x, w.y, instances, state.design, def)
      const hitDef = hit && state.design.defs[hit.defId]
      if (hit && hitDef && isNavigableDef(hitDef)) {
        if (useSimStore.getState().mode === 'simulate') {
          useSimStore.getState().descend(hit.id)
        }
        state.navigateTo(hit.defId)
      }
    }

    // Escape (while the pointer is over the canvas) exits back up one level.
    let pointerOver = false
    const onPointerEnter = () => {
      pointerOver = true
    }
    const onPointerExit = () => {
      pointerOver = false
      useEditorStore.getState().setHoverPort(null)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && pointerOver) {
        const sim = useSimStore.getState()
        // At the top level in simulate mode, Escape leaves simulation entirely.
        if (sim.mode === 'simulate' && sim.path.length === 0) {
          sim.toggleMode()
          return
        }
        useEditorStore.getState().navigateUp()
        if (sim.mode === 'simulate') {
          sim.ascend()
        }
      } else if ((e.key === 'i' || e.key === 'I') && pointerOver) {
        const hover = useEditorStore.getState().hoverPort
        if (hover) {
          e.preventDefault()
          useEditorStore.getState().togglePinInversion(hover)
        }
      }
    }

    // A cancelled drag must also end the coalescing (otherwise future changes are
    // not recorded).
    const onPointerCancel = () => {
      if (drag?.type === 'move') {
        endMoveTransaction()
      }
      drag = null
      canvas.style.cursor = 'default'
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerCancel)
    canvas.addEventListener('pointerenter', onPointerEnter)
    canvas.addEventListener('pointerleave', onPointerExit)
    canvas.addEventListener('dblclick', onDblClick)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKeyDown)

    return () => {
      ro.disconnect()
      unsub()
      unsubTheme()
      unsubSim()
      endMoveTransaction()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerCancel)
      canvas.removeEventListener('pointerenter', onPointerEnter)
      canvas.removeEventListener('pointerleave', onPointerExit)
      canvas.removeEventListener('dblclick', onDblClick)
      canvas.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  // After a design load or a descent into a component (canvas double-click, library
  // template, or sidebar), center and zoom the current sheet's contents to fit the
  // viewport. Driven by `fitToken`, which increments on each load/descent; we track the
  // last handled token so it fits exactly once per request.
  const lastFitToken = useRef(-1)
  useEffect(() => {
    const fit = () => {
      const state = useEditorStore.getState()
      if (state.fitToken === lastFitToken.current) return
      lastFitToken.current = state.fitToken
      const currentDef = state.design.defs[currentDefId(state)]
      if (!currentDef) return
      const bounds = defContentsBounds(state.design, currentDef)
      const wrap = wrapRef.current
      if (bounds && wrap) {
        state.setViewport(fitViewport(bounds, wrap.clientWidth, wrap.clientHeight))
      }
    }
    fit()
    return useEditorStore.subscribe(fit)
  }, [])

  // Accept drops from the component library and create an instance at the drop point.
  const handleDragOver = (e: React.DragEvent) => {
    if (useSimStore.getState().mode === 'simulate') return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  const handleDrop = (e: React.DragEvent) => {
    // No placement while simulating.
    if (useSimStore.getState().mode === 'simulate') return
    const defId = e.dataTransfer.getData('application/x-gatefold-def')
    if (!defId) return
    const state = useEditorStore.getState()
    const rect = wrapRef.current!.getBoundingClientRect()
    const wx = state.viewport.x + (e.clientX - rect.left - rect.width / 2) / state.viewport.zoom
    const wy = state.viewport.y + (e.clientY - rect.top - rect.height / 2) / state.viewport.zoom
    state.addInstance(defId, { x: wx, y: wy })
  }

  return (
    <div ref={wrapRef} className="canvas-area" onDragOver={handleDragOver} onDrop={handleDrop}>
      <canvas ref={canvasRef} className="canvas" />
    </div>
  )
}
