import { useEffect, useRef } from 'react'
import type { CompositeDef, Instance } from '@gatefold/model'
import { MAIN_INSTANCE_ID, childPrimitive, findConnectionTo, pinRefEquals, primitiveOf, valueFormatOf, valueOrderOf } from '@gatefold/model'
import { drawScene } from '../editor/renderer'
import { hitTest, hitTestPort, instanceBounds, hitArrayIndicator, defContentsBounds, arrayLaneCount, switchValueBadge, switchStepBadges, setLaneDistance } from '../editor/geometry'
import { s2w } from '../editor/viewport'
import { darkPalette, lightPalette } from '../editor/palette'
import { formatSpeed } from '../util/format'
import { useTestStore } from '../state/testStore'
import { currentTestbenchComposite, useEditorStore, beginMoveTransaction, endMoveTransaction, TEST_IO_KINDS } from '../state/editorStore'
import { useUiStore } from '../state/uiStore'
import { useSimStore, testColorOf, testValueOf, testSignalOf } from '../state/simStore'
import { PRIMITIVE_ICONS } from '../icons'
import type { Viewport } from '../editor/types'

/**
 * The "Testing" tab: the test-bench sheet one level above the top-level design. A fixed
 * (non-deletable but movable) `main` box shows the root's input/output ports; outside-world
 * components (clocks, switches, LEDs, 7-seg displays, probes) are placed and wired to it.
 * This sheet is excluded from Verilog export; in simulate mode it drives/reads `main`.
 */

type Drag =
  | { type: 'pan'; startX: number; startY: number; vp: Viewport }
  | { type: 'move'; ids: string[]; startX: number; startY: number; origins: { x: number; y: number }[] }
  | { type: 'marquee'; startX: number; startY: number; startWorld: { x: number; y: number } }
  | { type: 'shiftClick'; id: string; startX: number; startY: number; vp: Viewport }
  | { type: 'wire'; from: { instanceId: string; portId: string }; originalId: string | null }

const MIN_ZOOM = 0.15
const MAX_ZOOM = 4
const DRAG_THRESHOLD = 4

function fitViewport(bounds: { x: number; y: number; w: number; h: number }, cw: number, ch: number): Viewport {
  const cx = bounds.x + bounds.w / 2
  const cy = bounds.y + bounds.h / 2
  const zoom = Math.min(cw / bounds.w, ch / bounds.h) * 0.9
  return { x: cx, y: cy, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) }
}

function TestingCanvas() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const wrap = wrapRef.current!
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!

    const draw = () => {
      const design = useEditorStore.getState().design
      const ui = useUiStore.getState()
      setLaneDistance(ui.laneDistance)
      const palette = ui.theme === 'dark' ? darkPalette : lightPalette
      const composite = currentTestbenchComposite(design)
      const test = useTestStore.getState()
      const cw = wrap.clientWidth
      const ch = wrap.clientHeight
      const simState = useSimStore.getState()
      const sim = simState.mode === 'simulate' && simState.engine
        ? { colorOf: testColorOf, valueOf: testValueOf, signalOf: testSignalOf, speedLabel: formatSpeed(simState.timeScale) }
        : undefined
      drawScene(ctx, cw, ch, composite, composite, test.viewport, test.selectedIds, false, false, test.marquee, test.pendingWire, null, test.hoverPort, [], palette, sim)
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
    const unsubEditor = useEditorStore.subscribe(draw)
    const unsubTest = useTestStore.subscribe(draw)
    const unsubTheme = useUiStore.subscribe(draw)
    const unsubSim = useSimStore.subscribe(draw)

    let drag: Drag | null = null

    const toWorld = (sx: number, sy: number) => {
      const rect = wrap.getBoundingClientRect()
      return s2w(sx, sy, rect.width, rect.height, useTestStore.getState().viewport)
    }

    const composite = (): CompositeDef => currentTestbenchComposite(useEditorStore.getState().design)
    const instances = (): Instance[] => composite().instances
    const connections = () => composite().connections

    const startMoveDrag = (e: PointerEvent, instId: string) => {
      const state = useTestStore.getState()
      const selected = state.selectedIds.includes(instId)
      const ids = instId === MAIN_INSTANCE_ID ? [MAIN_INSTANCE_ID] : selected ? state.selectedIds : [instId]
      const byId = new Map(instances().map((i) => [i.id, i]))
      const origins = ids.map((id) => ({ ...byId.get(id)!.pos }))
      if (instId !== MAIN_INSTANCE_ID && !selected) state.setSelection([instId])
      beginMoveTransaction()
      drag = { type: 'move', ids, startX: e.clientX, startY: e.clientY, origins }
      canvas.style.cursor = 'grabbing'
      canvas.setPointerCapture(e.pointerId)
    }

    const onPointerDown = (e: PointerEvent) => {
      const state = useTestStore.getState()
      const rect = wrap.getBoundingClientRect()
      const w = toWorld(e.clientX - rect.left, e.clientY - rect.top)
      const insts = instances()
      const comp = composite()
      state.setHoverPort(null)

      // Simulate mode: no editing — toggle switches, allow shift-drag pan.
      if (useSimStore.getState().mode === 'simulate') {
        if (e.shiftKey) {
          drag = { type: 'pan', startX: e.clientX, startY: e.clientY, vp: { ...state.viewport } }
          canvas.style.cursor = 'grabbing'
          canvas.setPointerCapture(e.pointerId)
          return
        }
        const sx = e.clientX - rect.left
        const sy = e.clientY - rect.top
        for (const inst of [...insts].reverse()) {
          if (childPrimitive(inst.def) === 'switch-array') {
            const badge = switchValueBadge(comp, comp, inst, inst.def, wrap.clientWidth, wrap.clientHeight, state.viewport)
            if (badge && sx >= badge.x && sx <= badge.x + badge.s && sy >= badge.y && sy <= badge.y + badge.s) {
              const size = arrayLaneCount(comp, comp, inst, inst.def)
              if (size !== null) {
                useSimStore.getState().openTestSwitchDialog(inst.id, size, valueFormatOf(inst.props), valueOrderOf(inst.props))
              }
              return
            }
          }
        }
        for (const inst of [...insts].reverse()) {
          if (childPrimitive(inst.def) === 'switch-array') {
            const badges = switchStepBadges(comp, comp, inst, inst.def, wrap.clientWidth, wrap.clientHeight, state.viewport)
            if (!badges) continue
            const inRect = (b: { x: number; y: number; s: number }) => sx >= b.x && sx <= b.x + b.s && sy >= b.y && sy <= b.y + b.s
            if (inRect(badges.dec) || inRect(badges.inc)) {
              if (arrayLaneCount(comp, comp, inst, inst.def) !== null) {
                useSimStore.getState().stepTestSwitch(inst.id, inRect(badges.inc) ? 1 : -1)
              }
              return
            }
          }
        }
        for (const inst of [...insts].reverse()) {
          if (childPrimitive(inst.def) === 'switch-array' && inst.props?.compact !== true) {
            const lane = hitArrayIndicator(comp, w.x, w.y, comp, inst, inst.def, state.viewport.zoom)
            if (lane !== null) {
              useSimStore.getState().toggleTestSwitch(inst.id, lane)
              return
            }
          }
        }
        return
      }

      if (e.shiftKey) {
        const port = hitTestPort(comp, w.x, w.y, insts, comp)
        const markerInst = port && insts.find((i) => i.id === port.ref.instanceId)
        if (markerInst) {
          startMoveDrag(e, markerInst.id)
          return
        }
        const hit = hitTest(comp, w.x, w.y, insts, comp)
        if (hit) {
          if (hit.id !== MAIN_INSTANCE_ID) drag = { type: 'shiftClick', id: hit.id, startX: e.clientX, startY: e.clientY, vp: { ...state.viewport } }
          else startMoveDrag(e, hit.id)
        } else {
          drag = { type: 'pan', startX: e.clientX, startY: e.clientY, vp: { ...state.viewport } }
          canvas.style.cursor = 'grabbing'
        }
        canvas.setPointerCapture(e.pointerId)
        return
      }

      // Press an output pin to start a wire.
      const source = hitTestPort(comp, w.x, w.y, insts, comp, 'source')
      if (source) {
        drag = { type: 'wire', from: source.ref, originalId: null }
        state.setPendingWire({ from: source.ref, x: w.x, y: w.y })
        canvas.style.cursor = 'crosshair'
        canvas.setPointerCapture(e.pointerId)
        return
      }

      // Press an input that already has a wire to grab it.
      const sink = hitTestPort(comp, w.x, w.y, insts, comp, 'sink')
      if (sink) {
        const conn = findConnectionTo(connections(), sink.ref)
        if (conn) {
          drag = { type: 'wire', from: conn.from, originalId: conn.id }
          state.setPendingWire({ from: conn.from, x: w.x, y: w.y, originalId: conn.id })
          canvas.style.cursor = 'crosshair'
          canvas.setPointerCapture(e.pointerId)
          state.setHoverPort(sink.ref)
          return
        }
      }

      const hit = hitTest(comp, w.x, w.y, insts, comp)
      if (hit) {
        startMoveDrag(e, hit.id)
      } else {
        state.setSelection([])
        drag = { type: 'marquee', startX: e.clientX, startY: e.clientY, startWorld: w }
        canvas.style.cursor = 'crosshair'
        canvas.setPointerCapture(e.pointerId)
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      const state = useTestStore.getState()
      const d = drag

      if (useSimStore.getState().mode === 'simulate') {
        if (d?.type === 'pan') {
          const dx = e.clientX - d.startX
          const dy = e.clientY - d.startY
          state.setViewport({ x: d.vp.x - dx / d.vp.zoom, y: d.vp.y - dy / d.vp.zoom, zoom: d.vp.zoom })
        }
        return
      }

      if (!d) {
        const rect = wrap.getBoundingClientRect()
        const w = toWorld(e.clientX - rect.left, e.clientY - rect.top)
        const comp = composite()
        const port = hitTestPort(comp, w.x, w.y, instances(), comp)
        state.setHoverPort(port ? port.ref : null)
        return
      }

      switch (d.type) {
        case 'pan': {
          const dx = e.clientX - d.startX
          const dy = e.clientY - d.startY
          state.setViewport({ x: d.vp.x - dx / d.vp.zoom, y: d.vp.y - dy / d.vp.zoom, zoom: d.vp.zoom })
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
          useEditorStore.getState().setTestInstancesPosition(d.ids, d.origins.map((o) => ({ x: o.x + dx, y: o.y + dy })))
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
          const comp = composite()
          const selected = instances()
            .filter((inst) => inst.id !== MAIN_INSTANCE_ID)
            .filter((inst) => {
              const b = instanceBounds(comp, comp, inst, inst.def)
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
          const comp = composite()
          const target = hitTestPort(comp, cur.x, cur.y, instances(), comp, 'sink')
          state.setHoverPort(target ? target.ref : null)
          return
        }
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      const d = drag
      if (d?.type === 'shiftClick') useTestStore.getState().toggleSelected(d.id)
      if (d?.type === 'marquee') useTestStore.getState().setMarquee(null)
      if (d?.type === 'move') endMoveTransaction()
      if (d?.type === 'wire') {
        const state = useTestStore.getState()
        const rect = wrap.getBoundingClientRect()
        const w = toWorld(e.clientX - rect.left, e.clientY - rect.top)
        const comp = composite()
        const port = hitTestPort(comp, w.x, w.y, instances(), comp, 'sink')
        if (port) {
          if (d.originalId) {
            const original = connections().find((c) => c.id === d.originalId)
            if (original && pinRefEquals(port.ref, original.to)) {
              // Released back onto the original target — no change.
            } else {
              useEditorStore.getState().retargetTestConnection(d.originalId!, port.ref)
            }
          } else {
            useEditorStore.getState().addTestConnection(d.from, port.ref)
          }
        } else if (d.originalId) {
          useEditorStore.getState().removeTestConnection(d.originalId)
        }
        state.setPendingWire(null)
      }
      drag = null
      canvas.style.cursor = 'default'
      canvas.releasePointerCapture(e.pointerId)
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const state = useTestStore.getState()
      const vp = state.viewport
      const factor = Math.pow(1.0015, -e.deltaY)
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, vp.zoom * factor))
      const rect = wrap.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const w0x = vp.x + (mx - rect.width / 2) / vp.zoom
      const w0y = vp.y + (my - rect.height / 2) / vp.zoom
      state.setViewport({ x: w0x - (mx - rect.width / 2) / zoom, y: w0y - (my - rect.height / 2) / zoom, zoom })
    }

    let pointerOver = false
    const onPointerEnter = () => {
      pointerOver = true
    }
    const onPointerExit = () => {
      pointerOver = false
      useTestStore.getState().setHoverPort(null)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (useSimStore.getState().switchDialog) return
      if (e.key === 'Escape' && pointerOver && useSimStore.getState().mode === 'simulate') {
        useSimStore.getState().toggleMode()
      }
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('pointerenter', onPointerEnter)
    canvas.addEventListener('pointerleave', onPointerExit)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKeyDown)

    return () => {
      ro.disconnect()
      unsubEditor()
      unsubTest()
      unsubTheme()
      unsubSim()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('pointerenter', onPointerEnter)
      canvas.removeEventListener('pointerleave', onPointerExit)
      canvas.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  // Frame the test bench when the tab opens.
  const fitted = useRef(false)
  useEffect(() => {
    if (fitted.current) return
    fitted.current = true
    const comp = currentTestbenchComposite(useEditorStore.getState().design)
    const bounds = defContentsBounds(comp, comp)
    const wrap = wrapRef.current
    if (bounds && wrap) {
      useTestStore.getState().setViewport(fitViewport(bounds, wrap.clientWidth, wrap.clientHeight))
    }
  }, [])

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  const handleDrop = (e: React.DragEvent) => {
    const kind = e.dataTransfer.getData('application/x-gatefold-def')
    if (!kind) return
    const state = useTestStore.getState()
    const rect = wrapRef.current!.getBoundingClientRect()
    const wx = state.viewport.x + (e.clientX - rect.left - rect.width / 2) / state.viewport.zoom
    const wy = state.viewport.y + (e.clientY - rect.top - rect.height / 2) / state.viewport.zoom
    useEditorStore.getState().addTestInstance(kind, { x: wx, y: wy })
  }

  return (
    <div ref={wrapRef} className="canvas-area" onDragOver={handleDragOver} onDrop={handleDrop}>
      <canvas ref={canvasRef} className="canvas" />
    </div>
  )
}

export function TestingView() {
  const simulating = useSimStore((s) => s.mode) === 'simulate'
  return (
    <div className="testing">
      <div className="testing-palette">
        {TEST_IO_KINDS.map((kind) => {
          const prim = primitiveOf(kind)
          return (
            <button
              key={kind}
              className="testing-palette-item"
              draggable={!simulating}
              onDragStart={(e) => e.dataTransfer.setData('application/x-gatefold-def', kind)}
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
        <span className="testing-hint">Drag a component onto the sheet to drive or read the “{useEditorStore.getState().design.root.name}” ports</span>
      </div>
      <TestingCanvas />
    </div>
  )
}
