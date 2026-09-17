import { useEffect, useRef } from 'react'
import { useSimStore, signalColor } from '../state/simStore'
import { useUiStore } from '../state/uiStore'
import { formatTime } from '../util/format'
import type { Signal } from '@gatefold/model'
import type { HistoryBuffer } from '@gatefold/sim'

/**
 * The "Simulation timeline" tab: a digital-waveform view of every probe lane across the
 * design. Each probe lane is one horizontal row whose line color follows the recorded
 * signal (1 / 0 / x) over simulated time. The x-axis is time-proportional (distance is
 * proportional to the time difference between events); the mouse wheel zooms in time,
 * press-and-drag pans horizontally, and rows that don't fit scroll vertically.
 */

const LABEL_W = 160
const ROW_H = 22
const AXIS_H = 26
const MIN_PX_PER_UNIT = 1e-9 // px per ps (min zoom-out)
const MAX_PX_PER_UNIT = 1 // px per ps (max zoom-in)

interface Transition {
  t: number
  value: Signal
}

export function TimelineView() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const vpRef = useRef({ pxPerUnit: 1, viewStart: 0 })
  const fittedRef = useRef<HistoryBuffer | null>(null)
  const cacheRef = useRef<{ history: HistoryBuffer | null; revision: number; lanes: Transition[][] }>({
    history: null,
    revision: -1,
    lanes: [],
  })

  useEffect(() => {
    const scroll = scrollRef.current!
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!

    const colors = (theme: string) => ({
      bg: theme === 'dark' ? '#0d1117' : '#f6f8fa',
      text: theme === 'dark' ? '#e6edf3' : '#1f2328',
      muted: theme === 'dark' ? '#8b949e' : '#59616c',
      faint: theme === 'dark' ? '#5b6673' : '#8b949e',
      grid: theme === 'dark' ? '#1c2129' : '#eef1f4',
      border: theme === 'dark' ? '#262d37' : '#d4dae1',
    })

    const draw = () => {
      const theme = useUiStore.getState().theme
      const history = useSimStore.getState().history
      const c = colors(theme)

      const width = scroll.clientWidth
      const laneCount = history?.labelCount ?? 0
      const contentH = AXIS_H + laneCount * ROW_H + 8
      const height = Math.max(scroll.clientHeight, contentH)

      const dpr = window.devicePixelRatio || 1
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr)
        canvas.height = Math.round(height * dpr)
        canvas.style.width = `${width}px`
        canvas.style.height = `${height}px`
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = c.bg
      ctx.fillRect(0, 0, width, height)

      // Empty state: nothing recorded yet (or no probes in the design).
      if (!history || laneCount === 0) {
        ctx.fillStyle = c.muted
        ctx.font = '13px system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(
          history ? 'No probes in the design' : 'Run a simulation to record a timeline',
          width / 2,
          height / 2,
        )
        return
      }

      // Rebuild the per-lane transition list when the buffer changes (cheap to skip on pan/zoom).
      const cache = cacheRef.current
      if (cache.history !== history || cache.revision !== history.revision) {
        const lanes: Transition[][] = Array.from({ length: laneCount }, () => [])
        for (let i = 0; i < laneCount; i++) lanes[i].push(history.baseOf(i))
        history.forEachEvent((e) => lanes[e.lane].push({ t: e.t, value: e.value }))
        cacheRef.current = { history, revision: history.revision, lanes }
      }
      const lanes = cacheRef.current.lanes

      // Auto-fit the first time (or on a fresh simulation).
      if (fittedRef.current !== history) {
        const minT = history.minTime()
        const maxT = Math.max(history.maxTime(), minT + 1)
        const span = maxT - minT
        vpRef.current.pxPerUnit = Math.min(MAX_PX_PER_UNIT, Math.max(MIN_PX_PER_UNIT, (width - LABEL_W - 16) / span))
        vpRef.current.viewStart = minT - span * 0.02
        fittedRef.current = history
      }

      const vp = vpRef.current
      const xOf = (t: number) => LABEL_W + (t - vp.viewStart) * vp.pxPerUnit
      const tOf = (x: number) => vp.viewStart + (x - LABEL_W) / vp.pxPerUnit

      // Time ruler + gridlines.
      ctx.fillStyle = c.faint
      ctx.font = '10px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const targetStep = 80 / vp.pxPerUnit
      const step = niceStep(targetStep)
      const t0 = Math.ceil(tOf(LABEL_W) / step) * step
      const t1 = tOf(width)
      for (let t = t0; t <= t1; t += step) {
        const x = xOf(t)
        ctx.strokeStyle = c.grid
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(x, AXIS_H)
        ctx.lineTo(x, height)
        ctx.stroke()
        ctx.fillStyle = c.faint
        ctx.fillText(formatTime(t), x, AXIS_H / 2)
      }

      // Label / waveform divider.
      ctx.strokeStyle = c.border
      ctx.beginPath()
      ctx.moveTo(LABEL_W, 0)
      ctx.lineTo(LABEL_W, height)
      ctx.stroke()

      // One row per lane: label on the left, signal line on the right.
      for (let i = 0; i < laneCount; i++) {
        const y = AXIS_H + i * ROW_H + ROW_H / 2
        if (i % 2 === 1) {
          ctx.fillStyle = c.grid
          ctx.fillRect(LABEL_W, y - ROW_H / 2, width - LABEL_W, ROW_H)
        }
        ctx.fillStyle = c.text
        ctx.font = '11px system-ui, sans-serif'
        ctx.textAlign = 'right'
        ctx.textBaseline = 'middle'
        ctx.fillText(history.label(i), LABEL_W - 8, y)

        const row = lanes[i]
        for (let k = 0; k < row.length; k++) {
          const tA = row[k].t
          const tB = k + 1 < row.length ? row[k + 1].t : t1
          if (tB <= vp.viewStart) continue
          const xA = Math.max(LABEL_W, xOf(tA))
          const xB = Math.min(width, xOf(tB))
          if (xB < xA) continue
          ctx.strokeStyle = signalColor(row[k].value, theme)
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.moveTo(xA, y)
          ctx.lineTo(xB, y)
          ctx.stroke()
        }
      }

      // Limit-reached badge (STOP mode).
      if (history.full) {
        ctx.fillStyle = '#d29922'
        ctx.font = '11px system-ui, sans-serif'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillText('History limit reached — simulation stopped', 8, 6)
      }
    }

    const resize = () => {
      draw()
    }

    const ro = new ResizeObserver(resize)
    ro.observe(scroll)
    draw()
    const unsubSim = useSimStore.subscribe(draw)
    const unsubTheme = useUiStore.subscribe(draw)

    let dragging = false
    let lastX = 0

    const onPointerDown = (e: PointerEvent) => {
      dragging = true
      lastX = e.clientX
      canvas.setPointerCapture(e.pointerId)
      canvas.style.cursor = 'grabbing'
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return
      const dx = e.clientX - lastX
      lastX = e.clientX
      vpRef.current.viewStart -= dx / vpRef.current.pxPerUnit
      draw()
    }
    const onPointerUp = () => {
      dragging = false
      canvas.style.cursor = 'default'
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const anchor = vpRef.current.viewStart + (mx - LABEL_W) / vpRef.current.pxPerUnit
      const factor = Math.pow(1.0015, -e.deltaY)
      vpRef.current.pxPerUnit = Math.min(MAX_PX_PER_UNIT, Math.max(MIN_PX_PER_UNIT, vpRef.current.pxPerUnit * factor))
      vpRef.current.viewStart = anchor - (mx - LABEL_W) / vpRef.current.pxPerUnit
      draw()
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      ro.disconnect()
      unsubSim()
      unsubTheme()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('wheel', onWheel)
    }
  }, [])

  return (
    <div className="timeline">
      <div ref={scrollRef} className="timeline-scroll">
        <canvas ref={canvasRef} className="timeline-canvas" />
      </div>
    </div>
  )
}

/** Round a time step to a "nice" value (1, 2, or 5 × 10^n) at or above `min`. */
function niceStep(min: number): number {
  const exp = Math.pow(10, Math.floor(Math.log10(min)))
  for (const m of [1, 2, 5, 10]) {
    if (m * exp >= min) return m * exp
  }
  return 10 * exp
}
