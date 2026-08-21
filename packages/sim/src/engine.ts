import type { Design, Signal } from '@logica/model'
import { primitiveOf } from '@logica/model'
import { DEFAULT_CONFIG, delayOf, type SimConfig } from './config'
import { flatten, type FlatInstance } from './netlist'
import { clockValue, equalVectors, invertVector } from './signals'

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
}

interface Gate {
  inst: FlatInstance
  delay: number
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
  private values: (Signal[] | undefined)[]
  private fanout: Gate[][]
  private version: number[]
  private switchState = new Map<string, Signal[]>()
  private events = new MinHeap()
  private timeValue = 0
  private stepMode: SimConfig['stepMode']

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
    this.version = new Array(n).fill(0)
    this.gates = []

    for (const inst of this.instances) {
      const isGate = inst.inputs.length > 0 && inst.outputs.length > 0
      const isSource = inst.inputs.length === 0 && inst.outputs.length > 0
      if (isGate) {
        const gate: Gate = { inst, delay: delayOf(config, inst.kind) }
        this.gates.push(gate)
        for (const ip of inst.inputs) this.fanout[ip.net].push(gate)
      } else if (isSource) {
        const values = this.sourceValues(inst, 0)
        for (let j = 0; j < inst.outputs.length; j++) {
          this.values[inst.outputs[j].net] = values[j] ?? ['x']
        }
      }
    }

    this.powerOnSettle()
  }

  get time(): number {
    return this.timeValue
  }

  private valueOf(net: number): Signal[] {
    return this.values[net] ?? ['x']
  }

  private sourceValues(inst: FlatInstance, now: number): Signal[][] {
    if (inst.kind === 'clock') {
      const period = typeof inst.props?.period === 'number' ? inst.props.period : 10_000
      return [[clockValue(period, now)]]
    }
    const lanes = this.laneCount(inst)
    const state = this.switchState.get(inst.id) ?? Array.from({ length: lanes }, () => 0 as Signal)
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

  private driveSource(inst: FlatInstance, now: number): void {
    const values = this.sourceValues(inst, now)
    for (let j = 0; j < inst.outputs.length; j++) {
      const out = inst.outputs[j]
      this.version[out.net]++
      this.values[out.net] = values[j] ?? ['x']
      for (const g of this.fanout[out.net]) this.evaluateGate(g, now)
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
      this.schedule(now + gate.delay, op.net, v)
    }
  }

  private schedule(t: number, net: number, value: Signal[]): void {
    this.version[net]++
    this.events.push({ t, net, value, v: this.version[net] })
  }

  /** Settle combinational logic to quiescence at the current time. False if oscillating. */
  step(): boolean {
    if (this.stepMode === 'clock-edge') {
      const delta = this.nextClockEdgeDelta()
      if (delta !== null) return this.advanceTo(this.timeValue + delta)
    }
    return this.settle()
  }

  /** Change how `step()` advances (no rebuild needed). */
  setStepMode(mode: SimConfig['stepMode']): void {
    this.stepMode = mode
  }

  /** Time until the next clock edge (min half-period across all clocks), or null. */
  private nextClockEdgeDelta(): number | null {
    let best: number | null = null
    for (const inst of this.instances) {
      if (inst.kind !== 'clock') continue
      const period = typeof inst.props?.period === 'number' ? inst.props.period : 10_000
      const half = period / 2
      if (half <= 0) continue
      const next = (Math.floor(this.timeValue / half) + 1) * half
      const delta = next - this.timeValue
      if (best === null || delta < best) best = delta
    }
    return best
  }

  /** Advance time to `t`, recompute clock sources, and settle. */
  advanceTo(t: number): boolean {
    this.timeValue = t
    for (const inst of this.instances) {
      if (inst.kind === 'clock') this.driveSource(inst, t)
    }
    return this.settle()
  }

  setSwitch(id: string, value: Signal): void {
    this.setLane(id, 0, value)
  }

  /** Toggle a single lane of a switch source (single switch = lane 0). */
  toggleSwitch(id: string, lane = 0): void {
    this.setLane(id, lane, this.laneValue(id, lane) === 1 ? 0 : 1)
  }

  private laneValue(id: string, lane: number): Signal {
    const inst = this.instances.find((i) => i.id === id)
    if (!inst) return 0
    return this.switchState.get(id)?.[lane] ?? 0
  }

  private setLane(id: string, lane: number, value: Signal): void {
    const inst = this.instances.find((i) => i.id === id)
    if (!inst) return
    const lanes = this.laneCount(inst)
    const state = [...(this.switchState.get(id) ?? Array.from({ length: lanes }, () => 0 as Signal))]
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

  private settle(): boolean {
    const changeCount = new Array(this.values.length).fill(0)
    let processed = 0
    while (this.events.size > 0) {
      const e = this.events.pop()!
      if (e.v !== this.version[e.net]) continue // superseded (inertial)
      if (++processed > MAX_EVENTS) return false
      this.timeValue = e.t
      if (equalVectors(this.valueOf(e.net), e.value)) continue
      changeCount[e.net]++
      if (changeCount[e.net] > OSC_LIMIT) {
        // Oscillating: freeze at unknown and stop propagating.
        this.values[e.net] = Array.from({ length: this.netWidths[e.net] }, () => 'x' as Signal)
        continue
      }
      this.values[e.net] = e.value
      for (const g of this.fanout[e.net]) this.evaluateGate(g, e.t)
    }
    return true
  }
}
