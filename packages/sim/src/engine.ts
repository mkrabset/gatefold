import type { Design, Signal } from '@gatefold/model'
import { primitiveOf, periodOf } from '@gatefold/model'
import { DEFAULT_CONFIG, delayOf, type SimConfig } from './config'
import { flatten, type FlatInstance, type FlatPort } from './netlist'
import { clockValue, equalVectors, invert, invertVector } from './signals'

/** Per-net change threshold above which a net is considered oscillating. */
const OSC_LIMIT = 200
/** Safety cap on events processed per settle. */
const MAX_EVENTS = 1_000_000
/** Iteration cap for the zero-delay power-on settle. */
const MAX_POWERON_ITER = 2000

interface Event {
  t: number
  net: number
  value: Signal[]
  v: number
  /** The clock-edge time that triggered this event's cascade (for gate/DFF events). */
  edge?: number
}

interface Gate {
  inst: FlatInstance
  delay: number
}

/** A stateful, edge-triggered primitive (e.g. a D flip-flop with async reset). */
interface Sequential {
  inst: FlatInstance
  delay: number
  clkInput: FlatPort
  dInput: FlatPort
  rstInput: FlatPort | null
  outputs: FlatPort[]
  /** Output port id whose value is the complement of the register state, or null. */
  complementId: string | null
  edge: 'posedge' | 'negedge'
  resetActiveHigh: boolean
  resetValue: Signal
  lastClk: Signal
}

/** State for an event-driven clock source (at most one pending edge event at a time). */
interface ClockState {
  net: number
  half: number
  period: number
}

/** Minimal binary min-heap keyed by event time. */
class MinHeap {
  private a: Event[] = []

  get size(): number {
    return this.a.length
  }

  push(x: Event): void {
    const a = this.a
    a.push(x)
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p].t <= a[i].t) break
      ;[a[p], a[i]] = [a[i], a[p]]
      i = p
    }
  }

  pop(): Event | undefined {
    const a = this.a
    if (a.length === 0) return undefined
    const top = a[0]
    const last = a.pop()!
    if (a.length > 0) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < a.length && a[l].t < a[m].t) m = l
        if (r < a.length && a[r].t < a[m].t) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]
        i = m
      }
    }
    return top
  }

  peek(): Event | undefined {
    return this.a.length > 0 ? this.a[0] : undefined
  }
}

/**
 * Event-driven circuit simulation with inertial gate delays. Reads a `Design` and
 * never mutates it; holds only the flattened netlist and signal state.
 */
export class Simulation {
  private instances: FlatInstance[]
  private netWidths: number[]
  private driven: boolean[]
  private pinNet: Map<string, number>
  private gates: Gate[]
  private sequentials: Sequential[]
  private clocks: ClockState[] = []
  private clockByNet = new Map<number, ClockState>()
  private values: (Signal[] | undefined)[]
  private fanout: Gate[][]
  private seqFanout: Sequential[][]
  private version: number[]
  private switchState = new Map<string, Signal[]>()
  private events = new MinHeap()
  private timeValue = 0
  private stepMode: SimConfig['stepMode']
  /** Latched: the logic has failed to settle within half a clock period. */
  timingHalfViolation = false
  /** Latched: the logic has failed to settle within a full clock period. */
  timingFullViolation = false
  /** The clock-edge time that started the cascade currently being processed. */
  private currentEdgeTime = 0

  constructor(design: Design, config: SimConfig = DEFAULT_CONFIG) {
    const netlist = flatten(design)
    this.instances = netlist.instances
    this.netWidths = netlist.netWidths
    this.driven = netlist.driven
    this.pinNet = netlist.pinNet
    this.stepMode = config.stepMode

    const n = netlist.netCount
    // Power-on: driven nets start at 0; floating (undriven) nets stay unknown.
    this.values = Array.from({ length: n }, (_, i) =>
      Array.from({ length: this.netWidths[i] }, () => (this.driven[i] ? 0 : ('x' as Signal))),
    )
    this.fanout = Array.from({ length: n }, () => [])
    this.seqFanout = Array.from({ length: n }, () => [])
    this.version = new Array(n).fill(0)
    this.gates = []
    this.sequentials = []

    for (const inst of this.instances) {
      if (primitiveOf(inst.kind).isSequential()) {
        this.addSequential(inst, config)
        continue
      }
      if (inst.kind === 'clock') {
        this.addClock(inst)
        continue
      }
      const isGate = inst.inputs.length > 0 && inst.outputs.length > 0
      const isSource = inst.inputs.length === 0 && inst.outputs.length > 0
      if (isGate) {
        const gate: Gate = { inst, delay: delayOf(config, inst.kind) }
        this.gates.push(gate)
        for (const ip of inst.inputs) this.fanout[ip.net].push(gate)
      } else if (isSource) {
        const values = this.sourceValues(inst)
        for (let j = 0; j < inst.outputs.length; j++) {
          const out = inst.outputs[j]
          const v = values[j] ?? ['x']
          this.values[out.net] = out.inverted ? invertVector(v) : v
        }
      }
    }

    this.powerOnSettle()

    // Initialise each sequential's last-seen clock from the settled clock net, so the
    // first edge after power-on is detected correctly (including gated clocks).
    for (const seq of this.sequentials) {
      seq.lastClk = this.valueOf(seq.clkInput.net)[0]
    }
  }

  get time(): number {
    return this.timeValue
  }

  private valueOf(net: number): Signal[] {
    return this.values[net] ?? ['x']
  }

  private sourceValues(inst: FlatInstance): Signal[][] {
    const lanes = this.laneCount(inst)
    const state = this.switchState.get(inst.id) ?? this.defaultLanes(inst)
    if (inst.outputs.length === 1) {
      return [state.slice(0, lanes)]
    }
    return inst.outputs.map((_, i) => [state[i] ?? 0])
  }

  private laneCount(inst: FlatInstance): number {
    if (inst.outputs.length === 1) {
      return this.netWidths[inst.outputs[0].net]
    }
    return inst.outputs.length
  }

  /** The switch source's default lane values, from its `initialValue` property. */
  private defaultLanes(inst: FlatInstance): Signal[] {
    const on = typeof inst.props?.initialValue === 'boolean' && inst.props.initialValue
    return Array.from({ length: this.laneCount(inst) }, () => (on ? 1 : 0) as Signal)
  }

  /** Seed an event-driven clock source: set its power-on value and schedule its first edge. */
  private addClock(inst: FlatInstance): void {
    const period = periodOf(inst.props)
    const half = period / 2
    const out = inst.outputs[0]
    const initial = clockValue(period, 0)
    const output = out.inverted ? invert(initial) : initial
    const clock: ClockState = { net: out.net, half, period }
    this.clocks.push(clock)
    this.clockByNet.set(out.net, clock)
    this.values[out.net] = [output]
    if (half > 0) {
      this.schedule(half, out.net, [invert(output)])
    }
  }

  private driveSource(inst: FlatInstance, now: number): void {
    const values = this.sourceValues(inst)
    // A manual source toggle starts a fresh (non-clock) cascade, so its settling time is
    // not attributed to a stale clock edge.
    this.currentEdgeTime = now
    for (let j = 0; j < inst.outputs.length; j++) {
      const out = inst.outputs[j]
      const v = values[j] ?? ['x']
      this.version[out.net]++
      this.values[out.net] = out.inverted ? invertVector(v) : v
      for (const g of this.fanout[out.net]) this.evaluateGate(g, now)
      for (const s of this.seqFanout[out.net]) this.evaluateSequential(s, now)
    }
  }

  /**
   * Zero-delay power-on resolution: repeatedly evaluate all gates in place (fixed
   * order) until stable. This breaks `x` deadlocks in bi-stable feedback (latches,
   * gated JK) by settling to a valid stable state, and detects true oscillators.
   */
  private powerOnSettle(): void {
    const changeCount = new Array(this.values.length).fill(0)
    for (let iter = 0; iter < MAX_POWERON_ITER; iter++) {
      let changed = false
      for (const gate of this.gates) {
        const inputs: Signal[][] = gate.inst.inputs.map((ip) => {
          const v = this.valueOf(ip.net)
          return ip.inverted ? invertVector(v) : v
        })
        const outputs = primitiveOf(gate.inst.kind).transfer(inputs)
        for (let j = 0; j < gate.inst.outputs.length; j++) {
          const op = gate.inst.outputs[j]
          let v = outputs[j] ?? []
          if (op.inverted) v = invertVector(v)
          if (!equalVectors(this.valueOf(op.net), v)) {
            this.values[op.net] = v
            changeCount[op.net]++
            changed = true
          }
        }
      }
      if (!changed) return
    }
    // Iteration cap: freeze oscillating nets as unknown.
    for (let i = 0; i < this.values.length; i++) {
      if (changeCount[i] > OSC_LIMIT) {
        this.values[i] = Array.from({ length: this.netWidths[i] }, () => 'x' as Signal)
      }
    }
  }

  private evaluateGate(gate: Gate, now: number): void {
    const inputs: Signal[][] = gate.inst.inputs.map((ip) => {
      const v = this.valueOf(ip.net)
      return ip.inverted ? invertVector(v) : v
    })
    const outputs = primitiveOf(gate.inst.kind).transfer(inputs)
    for (let j = 0; j < gate.inst.outputs.length; j++) {
      const op = gate.inst.outputs[j]
      let v = outputs[j] ?? []
      if (op.inverted) v = invertVector(v)
      this.schedule(now + gate.delay, op.net, v, this.currentEdgeTime)
      this.latchTiming(now + gate.delay)
    }
  }

  /** Build the per-instance sequential state for a stateful primitive (e.g. a DFF). */
  private addSequential(inst: FlatInstance, config: SimConfig): void {
    const prim = primitiveOf(inst.kind)
    const clkInput = inst.inputs.find((ip) => ip.portId === prim.clockPortId?.()) ?? inst.inputs[0]
    const rstInput = inst.inputs.find((ip) => ip.portId === prim.resetPortId?.()) ?? null
    // `D` is the input that is neither the clock nor the reset (a DFF's only remaining
    // input), falling back to the first input for primitives without dedicated ids.
    const dInput = inst.inputs.find((ip) => ip !== clkInput && ip !== rstInput) ?? inst.inputs[0]
    const outputs = inst.outputs
    const complementId = prim.complementPortId?.() ?? null
    const resetValue: Signal = inst.props?.initialValue === true ? 1 : 0

    const seq: Sequential = {
      inst,
      delay: delayOf(config, inst.kind),
      clkInput,
      dInput,
      rstInput,
      outputs,
      complementId,
      edge: inst.props?.edge === 'negedge' ? 'negedge' : 'posedge',
      resetActiveHigh: inst.props?.resetActiveHigh !== false,
      resetValue,
      lastClk: 'x',
    }
    this.sequentials.push(seq)
    // Wake on both the clock and (when present) the async reset net.
    this.seqFanout[clkInput.net].push(seq)
    if (rstInput) this.seqFanout[rstInput.net].push(seq)

    // Power-on output values: apply the internal complement first, then the terminal
    // inversion (bubble), so `!Q` powers on to the inverse of `Q`.
    for (const op of outputs) {
      const internal = op.portId === complementId ? invert(resetValue) : resetValue
      this.values[op.net] = [op.inverted ? invert(internal) : internal]
    }
  }

  /**
   * Evaluate a sequential primitive on a clock/reset net change. Async reset forces the
   * output to its reset value; otherwise a configured clock edge samples D and schedules
   * the new output after the clk-to-q delay.
   */
  private evaluateSequential(seq: Sequential, now: number): void {
    const clk = seq.clkInput.inverted ? invert(this.valueOf(seq.clkInput.net)[0]) : this.valueOf(seq.clkInput.net)[0]
    const prev = seq.lastClk
    seq.lastClk = clk

    let next: Signal | null = null
    if (seq.rstInput) {
      const rst = seq.rstInput.inverted ? invert(this.valueOf(seq.rstInput.net)[0]) : this.valueOf(seq.rstInput.net)[0]
      if (rst === (seq.resetActiveHigh ? 1 : 0)) {
        next = seq.resetValue
      }
    }
    if (next === null) {
      const edge = seq.edge === 'posedge' ? prev === 0 && clk === 1 : prev === 1 && clk === 0
      if (edge) {
        next = seq.dInput.inverted ? invert(this.valueOf(seq.dInput.net)[0]) : this.valueOf(seq.dInput.net)[0]
      }
    }
    if (next !== null) {
      for (const op of seq.outputs) {
        const internal = op.portId === seq.complementId ? invert(next) : next
        const out = op.inverted ? invert(internal) : internal
        this.schedule(now + seq.delay, op.net, [out], this.currentEdgeTime)
      }
    }
  }

  private schedule(t: number, net: number, value: Signal[], edge?: number): void {
    this.version[net]++
    this.events.push({ t, net, value, v: this.version[net], ...(edge !== undefined ? { edge } : {}) })
  }

  /** Latch a timing breach when a single clock's logic settles too slowly. */
  private latchTiming(t: number): void {
    if (this.clocks.length !== 1) return
    const clock = this.clocks[0]
    const lag = t - this.currentEdgeTime
    if (lag > clock.half) this.timingHalfViolation = true
    if (lag > clock.period) this.timingFullViolation = true
  }

  /** Settle combinational logic to quiescence at the current time. False if oscillating. */
  step(): boolean {
    if (this.stepMode === 'clock-edge') {
      const delta = this.nextClockEdgeDelta()
      if (delta !== null) this.advanceTo(this.timeValue + delta)
    }
    return this.settle()
  }

  /** Change how `step()` advances (no rebuild needed). */
  setStepMode(mode: SimConfig['stepMode']): void {
    this.stepMode = mode
  }

  /** Time until the next clock edge (min half-period across all clocks), or null. */
  nextClockEdgeDelta(): number | null {
    let best: number | null = null
    for (const clock of this.clocks) {
      if (clock.half <= 0) continue
      const next = (Math.floor(this.timeValue / clock.half) + 1) * clock.half
      const delta = next - this.timeValue
      if (best === null || delta < best) best = delta
    }
    return best
  }

  /** True when the design has exactly one clock source (timing indicators apply). */
  hasSingleClock(): boolean {
    return this.clocks.length === 1
  }

  /** Clear the latched timing-breach lamps (e.g. on play/resume). */
  resetTiming(): void {
    this.timingHalfViolation = false
    this.timingFullViolation = false
  }

  /** Advance time to `t`, processing every event (including clock edges) up to `t`. */
  advanceTo(t: number): boolean {
    const ok = this.drainEvents((top) => top.t <= t)
    this.timeValue = t
    return ok
  }

  setSwitch(id: string, value: Signal): void {
    this.setLane(id, 0, value)
  }

  /** Toggle a single lane of a switch source (single switch = lane 0). */
  toggleSwitch(id: string, lane = 0): void {
    this.setLane(id, lane, this.laneValue(id, lane) === 1 ? 0 : 1)
  }

  /** Replace a switch source's whole lane vector with `bits` (padded/truncated to its lane count). */
  setSwitchLanes(id: string, bits: Signal[]): void {
    const inst = this.instances.find((i) => i.id === id)
    if (!inst) return
    const lanes = this.laneCount(inst)
    const state: Signal[] = []
    for (let i = 0; i < lanes; i++) state.push(bits[i] ?? 0)
    this.switchState.set(id, state)
    this.driveSource(inst, this.timeValue)
  }

  /** The current raw lane vector of a switch source (its switch settings), or undefined. */
  switchLanesOf(id: string): Signal[] | undefined {
    const inst = this.instances.find((i) => i.id === id)
    if (!inst) return undefined
    const lanes = this.laneCount(inst)
    return (this.switchState.get(id) ?? this.defaultLanes(inst)).slice(0, lanes)
  }

  private laneValue(id: string, lane: number): Signal {
    const inst = this.instances.find((i) => i.id === id)
    if (!inst) return 0
    return this.switchState.get(id)?.[lane] ?? this.defaultLanes(inst)[lane] ?? 0
  }

  private setLane(id: string, lane: number, value: Signal): void {
    const inst = this.instances.find((i) => i.id === id)
    if (!inst) return
    const state = [...(this.switchState.get(id) ?? this.defaultLanes(inst))]
    state[lane] = value
    this.switchState.set(id, state)
    this.driveSource(inst, this.timeValue)
  }

  /** Full bit-vector signal on a flattened pin (leaf, port group, or composite), or undefined. */
  signalOf(id: string, portId: string): Signal[] | undefined {
    const net = this.pinNet.get(`${id}:${portId}`)
    if (net === undefined) return undefined
    const v = this.valueOf(net)
    return v.length === 0 ? undefined : v
  }

  /** Single-bit signal (first bit) on a flattened instance pin. */
  signal(id: string, portId: string): Signal {
    return this.signalOf(id, portId)?.[0] ?? 'x'
  }

  /**
   * Process events while `shouldProcess` holds, advancing time through them. A clock-edge
   * event toggles its clock and schedules the next edge; other events propagate through the
   * fan-out (with inertial delay and oscillator detection). Returns false on a safety cap.
   */
  private drainEvents(shouldProcess: (top: Event) => boolean): boolean {
    const changeCount = new Array(this.values.length).fill(0)
    let processed = 0
    while (this.events.size > 0) {
      const top = this.events.peek()!
      if (!shouldProcess(top)) break
      const e = this.events.pop()!
      if (e.v !== this.version[e.net]) continue // superseded (inertial)
      if (++processed > MAX_EVENTS) return false
      this.timeValue = e.t
      if (equalVectors(this.valueOf(e.net), e.value)) continue
      const clock = this.clockByNet.get(e.net)
      if (clock) {
        // Clock edge: start a fresh cascade and schedule the next (toggled) edge.
        this.currentEdgeTime = e.t
        this.schedule(e.t + clock.half, e.net, [invert(e.value[0])])
      } else {
        // Gate/DFF event: restore the cascade's originating edge for lag attribution.
        this.currentEdgeTime = e.edge ?? this.currentEdgeTime
        changeCount[e.net]++
        if (changeCount[e.net] > OSC_LIMIT) {
          // Oscillating: freeze at unknown and stop propagating.
          this.values[e.net] = Array.from({ length: this.netWidths[e.net] }, () => 'x' as Signal)
          continue
        }
      }
      this.values[e.net] = e.value
      for (const g of this.fanout[e.net]) this.evaluateGate(g, e.t)
      for (const s of this.seqFanout[e.net]) this.evaluateSequential(s, e.t)
    }
    return true
  }

  /** Settle combinational logic without advancing the clock (stop at the next edge). */
  settle(): boolean {
    return this.drainEvents((top) => !this.clockByNet.has(top.net))
  }
}
