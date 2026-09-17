import { useEffect, useRef } from 'react'
import { useSimStore, signalColor } from '../state/simStore'
import { useUiStore } from '../state/uiStore'
import { formatTime } from '../util/format'
import type { Signal } from '@gatefold/model'
import type { HistoryBuffer } from '@gatefold/sim'

/**
 * The "Simulation timeline" tab: a digital-waveform view of every probe lane across the
 * design. Probes are grouped (a bus is one block of lanes); each group has a drag handle
 * and label on the left, and can be dragged up/down to reorder. Each lane's line color
 * follows the recorded signal (1 / 0 / x) over simulated time. The x-axis is
 * time-proportional; the mouse wheel zooms in time, press-and-drag on the waveform area
 * pans horizontally, and rows that don't fit scroll vertically.
 */

const LABEL_W = 160
const ROW_H = 22
const AXIS_H = 26
const MIN_PX_PER_UNIT = 1e-9 // px per ps (min zoom-out)
const MAX_PX_PER_UNIT = 1 // px per ps (max zoom-in)
const REORDER_THRESHOLD = 4 // px of vertical travel before a press becomes a reorder drag

interface Transition {
  t: number
  value: Signal
}

/** Map a user's probe order (labels) onto group indices, falling back to natural order. */
function computeOrder(history: HistoryBuffer, probeOrder: string[] | null): number[] {
  const n = history.groupCount
  const natural = Array.from({ length: n }, (_, i) => i)
  if (!probeOrder || probeOrder.length !== n) return natural
  const byLabel = new Map<string, number>()
  for (let i = 0; i < n; i++) byLabel.set(history.groupLabel(i), i)
  const order: number[] = []
  for (const label of probeOrder) {
    const idx = byLabel.get(label)
    if (idx === undefined) return natural
    order.push(idx)
  }
  return order
}

/** Move the element at `from` to `to`, returning a new array. */
function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const next = arr.slice()
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

export function TimelineView() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const vpRef = useRef({ pxPerUnit: 1, viewStart: 0 })
  const fittedRef = useRef<HistoryBuffer | null>(null)
  const hoverXRef = useRef<number | null>(null)
  const orderRef = useRef<number[]>([])
  const cacheRef = useRef<{ history: HistoryBuffer | null; revision: number; lanes: Transition[][] }>({
    history: null,
    revision: -1,
    lanes: [],
  })

  useEffect(() => {
    const scroll = scrollRef.current!
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!

    let panning = false
    let lastX = 0
    let reorder: { pos: number; startY: number; moved: boolean } | null = null

    const colors = (theme: string) => ({
      bg: theme === 'dark' ? '#0d1117' : '#f6f8fa',
      text: theme === 'dark' ? '#e6edf3' : '#1f2328',
      muted: theme === 'dark' ? '#8b949e' : '#59616c',
      faint: theme === 'dark' ? '#5b6673' : '#8b949e',
      grid: theme === 'dark' ? '#1c2129' : '#eef1f4',
      border: theme === 'dark' ? '#262d37' : '#d4dae1',
      cursor: theme === 'dark' ? '#4f8cff' : '#2563eb',
    })

    /** The recorded timeframe `[minT, maxT]`, or null when there is no history yet. */
    const bounds = (): { minT: number; maxT: number } | null => {
      const history = useSimStore.getState().history
      if (!history) return null
      return { minT: history.minTime(), maxT: history.maxTime() }
    }

    /** Keep the viewport within `[minT, maxT]`: no panning past either end, and no
     *  zooming out further than the whole timeframe fits on screen. */
    const clampView = (width: number, minT: number, maxT: number): void => {
      const plotW = Math.max(1, width - LABEL_W)
      const span = Math.max(maxT - minT, 1e-9)
      const fitPpu = plotW / span
      const vp = vpRef.current
      vp.pxPerUnit = Math.min(MAX_PX_PER_UNIT, Math.max(Math.max(fitPpu, MIN_PX_PER_UNIT), vp.pxPerUnit))
      const visibleSpan = plotW / vp.pxPerUnit
      const maxStart = Math.max(minT, maxT - visibleSpan)
      vp.viewStart = Math.min(Math.max(vp.viewStart, minT), maxStart)
    }

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
      const transitionLanes = cacheRef.current.lanes

      // Auto-fit the first time (or on a fresh simulation): show the whole timeframe.
      if (fittedRef.current !== history) {
        const minT = history.minTime()
        const maxT = history.maxTime()
        const plotW = Math.max(1, width - LABEL_W)
        const span = Math.max(maxT - minT, 1e-9)
        vpRef.current.pxPerUnit = Math.min(MAX_PX_PER_UNIT, plotW / span)
        vpRef.current.viewStart = minT
        clampView(width, minT, maxT)
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

      // Display order of groups (kept live during a reorder drag, else derived from the store).
      if (!reorder) {
        orderRef.current = computeOrder(history, useSimStore.getState().probeOrder)
      }
      const order = orderRef.current

      // One block per probe group, one row per lane within it.
      let top = AXIS_H
      let rowIndex = 0
      for (const gi of order) {
        const groupLanes = history.groupLanes(gi)
        const blockH = groupLanes * ROW_H
        const yCenter = top + blockH / 2
        const start = history.groupStart(gi)

        // Drag handle + group label, centered across the block.
        ctx.fillStyle = c.faint
        ctx.font = '11px system-ui, sans-serif'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText('⣿', 8, yCenter)
        ctx.fillStyle = c.text
        ctx.save()
        ctx.beginPath()
        ctx.rect(26, top, LABEL_W - 30, blockH)
        ctx.clip()
        ctx.fillText(history.groupLabel(gi), 26, yCenter)
        ctx.restore()

        for (let li = 0; li < groupLanes; li++) {
          const lane = start + li
          const y = top + li * ROW_H + ROW_H / 2
          if (rowIndex % 2 === 1) {
            ctx.fillStyle = c.grid
            ctx.fillRect(LABEL_W, y - ROW_H / 2, width - LABEL_W, ROW_H)
          }
          if (groupLanes > 1) {
            ctx.fillStyle = c.faint
            ctx.font = '10px system-ui, sans-serif'
            ctx.textAlign = 'right'
            ctx.textBaseline = 'middle'
            ctx.fillText(`[${li}]`, LABEL_W - 8, y)
          }

          const row = transitionLanes[lane]
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
          rowIndex++
        }
        top += blockH
      }

      // Limit-reached badge (STOP mode).
      if (history.full) {
        ctx.fillStyle = '#d29922'
        ctx.font = '11px system-ui, sans-serif'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillText('History limit reached — simulation stopped', 8, 6)
      }

      // Cursor guide line: a thin vertical line under the pointer, spanning the full
      // height so transitions on far-apart lanes are easy to line up.
      if (hoverXRef.current !== null) {
        ctx.strokeStyle = c.cursor
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(hoverXRef.current, 0)
        ctx.lineTo(hoverXRef.current, height)
        ctx.stroke()
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

    /** Display position of the group block under y, or -1 when over the axis/empty. */
    const groupPosAtY = (my: number): number => {
      const history = useSimStore.getState().history
      if (!history) return -1
      let top = AXIS_H
      for (let p = 0; p < orderRef.current.length; p++) {
        const blockH = history.groupLanes(orderRef.current[p]) * ROW_H
        if (my >= top && my < top + blockH) return p
        top += blockH
      }
      return -1
    }

    /** Desired display position (clamped) for the cursor's y, by group midpoints. */
    const targetPosAtY = (my: number): number => {
      const n = orderRef.current.length
      const history = useSimStore.getState().history
      if (!history || n === 0) return 0
      let top = AXIS_H
      for (let p = 0; p < n; p++) {
        const blockH = history.groupLanes(orderRef.current[p]) * ROW_H
        if (my < top + blockH / 2) return p
        top += blockH
      }
      return n - 1
    }

    const onPointerDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top

      // Over the label/handle column: start a reorder drag when a group is under the pointer.
      if (mx < LABEL_W) {
        const pos = groupPosAtY(my)
        if (pos !== -1) {
          reorder = { pos, startY: my, moved: false }
          hoverXRef.current = null
          canvas.setPointerCapture(e.pointerId)
          canvas.style.cursor = 'grabbing'
          return
        }
      }

      // Otherwise: horizontal pan of the waveform area.
      panning = true
      lastX = e.clientX
      canvas.setPointerCapture(e.pointerId)
      canvas.style.cursor = 'grabbing'
    }

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top

      if (reorder) {
        if (!reorder.moved && Math.abs(my - reorder.startY) < REORDER_THRESHOLD) return
        reorder.moved = true
        const target = targetPosAtY(my)
        if (target !== reorder.pos) {
          orderRef.current = moveItem(orderRef.current, reorder.pos, target)
          reorder.pos = target
        }
        draw()
        return
      }

      if (panning) {
        const dx = e.clientX - lastX
        lastX = e.clientX
        vpRef.current.viewStart -= dx / vpRef.current.pxPerUnit
        const b = bounds()
        if (b) clampView(scroll.clientWidth, b.minT, b.maxT)
        hoverXRef.current = mx
        draw()
      } else if (hoverXRef.current !== mx) {
        hoverXRef.current = mx
        draw()
      }
    }

    const onPointerUp = () => {
      if (reorder) {
        if (reorder.moved) {
          const history = useSimStore.getState().history
          if (history) {
            useSimStore.getState().setProbeOrder(orderRef.current.map((gi) => history.groupLabel(gi)))
          }
        }
        reorder = null
      }
      panning = false
      canvas.style.cursor = 'default'
      draw()
    }

    const onPointerLeave = () => {
      if (reorder) reorder = null
      if (hoverXRef.current !== null) {
        hoverXRef.current = null
        draw()
      }
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const anchor = vpRef.current.viewStart + (mx - LABEL_W) / vpRef.current.pxPerUnit
      const factor = Math.pow(1.0015, -e.deltaY)
      vpRef.current.pxPerUnit = vpRef.current.pxPerUnit * factor
      vpRef.current.viewStart = anchor - (mx - LABEL_W) / vpRef.current.pxPerUnit
      const b = bounds()
      if (b) clampView(scroll.clientWidth, b.minT, b.maxT)
      draw()
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('pointerleave', onPointerLeave)
    canvas.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      ro.disconnect()
      unsubSim()
      unsubTheme()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('pointerleave', onPointerLeave)
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
