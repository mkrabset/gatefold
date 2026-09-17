import type { Signal } from '@gatefold/model'

/** How the history buffer behaves when it reaches its event limit. */
export type HistoryLimitMode = 'stop' | 'sliding'

/** One probe-lane signal change at a point in simulated time. */
export interface HistoryEvent {
  /** Simulated time (picoseconds) of the transition. */
  t: number
  /** Probe-lane index (into the buffer's labels). */
  lane: number
  /** The lane's new value. */
  value: Signal
}

/** A probe in the history: its display label and how many lanes (wires) it carries. */
export interface HistoryGroup {
  label: string
  lanes: number
}

/**
 * Bounded history of probe signals for the simulation timeline. One event is recorded
 * per probe-lane *signal change*, in chronological order, into a fixed-capacity ring
 * buffer. When full, `stop` mode refuses further events and reports `full` (the
 * simulator then pauses); `sliding` mode overwrites the oldest event, carrying that
 * event's value forward into the affected lane's base so the timeline keeps a rolling
 * recent window.
 *
 * Each lane also keeps a `base` value — its state at (or before) the oldest retained
 * event — so the waveform can be drawn from the timeline's left edge even after the
 * earliest events have slid out.
 */
export class HistoryBuffer {
  private readonly cap: number
  private readonly limitMode: HistoryLimitMode
  private groups: HistoryGroup[] = []
  private groupStarts: number[] = []
  private labels: string[] = []
  private base: { t: number; value: Signal }[] = []
  private buf: HistoryEvent[] = []
  private head = 0
  private size = 0
  /** Bumped on every mutation, so views can cheaply invalidate their render cache. */
  private rev = 0
  /** Set once the event limit is reached in `stop` mode. */
  full = false

  constructor(maxEvents: number, limitMode: HistoryLimitMode) {
    this.cap = Math.max(1, Math.floor(maxEvents))
    this.limitMode = limitMode
  }

  get revision(): number {
    return this.rev
  }

  /** Replace the probe groups. Each group owns `lanes` contiguous lanes; the flattened
   *  labels (used for per-lane display) are `label` for a single lane, or `label[i]`. */
  setGroups(groups: HistoryGroup[]): void {
    this.groups = groups.map((g) => ({ label: g.label, lanes: Math.max(1, Math.floor(g.lanes)) }))
    this.groupStarts = []
    this.labels = []
    let n = 0
    for (const g of this.groups) {
      this.groupStarts.push(n)
      for (let i = 0; i < g.lanes; i++) this.labels.push(g.lanes > 1 ? `${g.label}[${i}]` : g.label)
      n += g.lanes
    }
    this.rev++
  }

  /** Convenience: treat every label as a single-lane probe. */
  setLabels(labels: string[]): void {
    this.setGroups(labels.map((label) => ({ label, lanes: 1 })))
  }

  get groupCount(): number {
    return this.groups.length
  }

  groupLabel(group: number): string {
    return this.groups[group]?.label ?? `${group}`
  }

  groupLanes(group: number): number {
    return this.groups[group]?.lanes ?? 1
  }

  /** The flattened lane index of a group's first lane. */
  groupStart(group: number): number {
    return this.groupStarts[group] ?? 0
  }

  get labelCount(): number {
    return this.labels.length
  }

  label(lane: number): string {
    return this.labels[lane] ?? `${lane}`
  }

  /** Seed a lane's starting value at time `t` (the trace's left edge). */
  setBase(lane: number, t: number, value: Signal): void {
    this.base[lane] = { t, value }
    this.rev++
  }

  baseOf(lane: number): { t: number; value: Signal } {
    return this.base[lane] ?? { t: 0, value: 'x' }
  }

  /** The number of recorded events (excluding the per-lane base). */
  get count(): number {
    return this.size
  }

  /** The maximum number of events this buffer holds. */
  get capacity(): number {
    return this.cap
  }

  /** Record a lane change at time `t`. A full buffer in `stop` mode records nothing. */
  record(lane: number, t: number, value: Signal): void {
    if (this.full) return
    if (this.size < this.cap) {
      this.buf[this.size] = { t, lane, value }
      this.size++
      this.rev++
      return
    }
    if (this.limitMode === 'stop') {
      this.full = true
      this.rev++
      return
    }
    // Sliding: overwrite the oldest event, promoting its value into that lane's base.
    const oldest = this.buf[this.head]
    this.base[oldest.lane] = { t: oldest.t, value: oldest.value }
    this.buf[this.head] = { t, lane, value }
    this.head = (this.head + 1) % this.cap
    this.rev++
  }

  /** Iterate the recorded events in chronological order. */
  forEachEvent(cb: (e: HistoryEvent) => void): void {
    for (let i = 0; i < this.size; i++) {
      cb(this.buf[(this.head + i) % this.cap])
    }
  }

  /** The earliest retained time (the timeline's left edge). */
  minTime(): number {
    let m = Infinity
    for (const b of this.base) if (b && b.t < m) m = b.t
    if (this.size > 0) {
      const first = this.buf[this.head]
      if (first.t < m) m = first.t
    }
    return m === Infinity ? 0 : m
  }

  /** The latest retained time (the timeline's right edge). */
  maxTime(): number {
    let m = -Infinity
    for (const b of this.base) if (b && b.t > m) m = b.t
    if (this.size > 0) {
      const last = this.buf[(this.head + this.size - 1) % this.cap]
      if (last.t > m) m = last.t
    }
    return m === -Infinity ? 0 : m
  }
}
