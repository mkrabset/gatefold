import type { ArrayChain, ArrayOrientation, ChildDef, CompositeDef, Connection, Instance, Port } from './types'
import { cloneComposite } from './group'
import { inputPortId, inputPorts, outputPortId, outputPorts } from './ports'
import { builtinOf } from './primitives'
import { uniqueId } from './util'

/**
 * Pure "array" generation: build a composite that contains `count` deep copies of a
 * template composite, wired into parallel buses (each non-chained terminal becomes a
 * `count`-wide bus) with optional inter-copy chaining (each `ArrayChain` wires
 * `copy[i].from → copy[i+1].to`, collapsing those terminals to single wires at the
 * boundary) and optional common inputs (`common` ports are delivered as one shared wire
 * to every copy, routed through a NODE join-point in the fan-out column).
 *
 * The result is an *ordinary* composite — its ports mirror the template's ports, and
 * the N copies are concrete inline instances. Bus bundling/unbundling uses the existing
 * FAN-IN/FAN-OUT primitives, so the width solver, simulator, and Verilog generator all
 * consume it unchanged. `arrayConfig` is stamped on the result so the store can
 * regenerate the internals when the size, chains, orientation, or common inputs change.
 *
 * Limitation: FAN-IN/FAN-OUT bundle *single-wire* lanes, so a template whose ports are
 * themselves buses (e.g. arraying an already-arrayed component) is not yet supported
 * for *parallel* ports. A *common* port is routed through a single-wire NODE, so it must
 * itself be single-wire. Arraying a single-wire composite — an N-bit ripple adder from a
 * full-adder, or a word mux from bit muxes — is the supported shape.
 *
 * @param template    The composite to replicate (the array's inner element).
 * @param count       Number of copies (clamped to ≥ 1).
 * @param chains      Inter-copy wiring rules (`from` is a template output, `to` an input).
 * @param usedIds     Global composite-id pool, so the copies get collision-free ids.
 * @param orientation Copies' layout direction (`horizontal` = left-to-right, `vertical` =
 *                    top-to-bottom). Purely cosmetic — only the internal positions change.
 * @param common      Input port ids shared by every copy (a single wire, not a bus).
 */
export function arrayComposite(
  template: CompositeDef,
  count: number,
  chains: ArrayChain[],
  usedIds: Set<string>,
  orientation: ArrayOrientation = 'horizontal',
  common: string[] = [],
): CompositeDef {
  const n = Math.max(1, Math.floor(count))
  // The left-to-right flow (input port → fan-outs → copies → fan-ins → output port) is
  // fixed; the copies' own layout runs horizontally or vertically. Vertical stacks the
  // copies much tighter than horizontal: a composite's height is smaller than its width,
  // so the horizontal spacing reads as an over-large gap when reused along the y axis.
  const FLOW_STEP = 160
  const ARRAY_STEP = orientation === 'horizontal' ? 160 : 80
  const arrayRightX = orientation === 'horizontal' ? (n - 1) * ARRAY_STEP : 0
  const centerY = orientation === 'horizontal' ? 0 : ((n - 1) * ARRAY_STEP) / 2
  const FAN_SPACING = 60

  const defId = uniqueId(usedIds, `${template.name || template.id}-array`, '~')
  usedIds.add(defId)

  const inIds = inputPorts(template.ports).map((p) => p.id)
  const outIds = outputPorts(template.ports).map((p) => p.id)
  const inputGroupId = inIds.length > 0 ? `${defId}-in` : null
  const outputGroupId = outIds.length > 0 ? `${defId}-out` : null

  // The interface is transparent: the array's ports mirror the template's by id/name,
  // each linked to this array's own port-group instance.
  const ports: Port[] = template.ports.map((p) => {
    const groupId = p.direction === 'input' ? inputGroupId : outputGroupId
    return groupId
      ? { id: p.id, name: p.name, direction: p.direction, terminal: { instanceId: groupId, pinId: p.id } }
      : { id: p.id, name: p.name, direction: p.direction }
  })

  // Layout: the flow is always left-to-right, but the copies line up along their
  // orientation axis. The port groups and fan columns sit to the left/right of the
  // copies, vertically centred on the array.
  const copyPos = (k: number): { x: number; y: number } => (orientation === 'horizontal' ? { x: k * ARRAY_STEP, y: 0 } : { x: 0, y: k * ARRAY_STEP })
  const inputPos = (): { x: number; y: number } => ({ x: -1.75 * FLOW_STEP, y: centerY })
  const outputPos = (): { x: number; y: number } => ({ x: arrayRightX + 1.75 * FLOW_STEP, y: centerY })
  // Spread a column of `count` nodes around the array's vertical centre, so the fans and
  // join-points of parallel/common inputs don't overlap.
  const fanSpread = (index: number, count: number): number => (index - (count - 1) / 2) * FAN_SPACING
  // Fan-outs and common-input join-points share the same left-side column.
  const inputSidePos = (index: number, count: number): { x: number; y: number } => ({ x: -0.75 * FLOW_STEP, y: centerY + fanSpread(index, count) })
  const fanInPos = (index: number, count: number): { x: number; y: number } => ({ x: arrayRightX + 0.75 * FLOW_STEP, y: centerY + fanSpread(index, count) })

  const chainedInputs = new Set(chains.map((c) => c.to))
  const chainedOutputs = new Set(chains.map((c) => c.from))
  // A common input is a shared single wire to every copy — the opposite of a parallel
  // bus. It must be a real, non-chained input (a chained input is already single-wire).
  const commonInputs = new Set(common.filter((p) => inIds.includes(p) && !chainedInputs.has(p)))
  const parallelOutIds = outIds.filter((p) => !chainedOutputs.has(p))
  // The left-side column, in port order: a fan-out per parallel input, a join-point per
  // common input. Chained inputs are wired directly (no column node).
  const inputNodes = inIds
    .filter((p) => !chainedInputs.has(p))
    .map((p) => ({ portId: p, common: commonInputs.has(p) }))

  const copyId = (k: number): string => `i${k}`

  // A fan-out bundles the N copies' single-wire version of one non-chained input port
  // into that port's `count`-wide bus; a fan-in does the reverse for an output port.
  const fanOutFork = (): ChildDef => {
    const ps: Port[] = [{ id: inputPortId(0), name: 'BUS', direction: 'input' }]
    for (let i = 0; i < n; i++) ps.push({ id: outputPortId(i), name: `Y${i + 1}`, direction: 'output' })
    return { kind: 'fork', primitive: 'fan-out', ports: ps }
  }
  const fanInFork = (): ChildDef => {
    const ps: Port[] = []
    for (let i = 0; i < n; i++) ps.push({ id: inputPortId(i), name: `A${i + 1}`, direction: 'input' })
    ps.push({ id: outputPortId(0), name: 'BUS', direction: 'output' })
    return { kind: 'fork', primitive: 'fan-in', ports: ps }
  }

  const instances: Instance[] = []
  for (let k = 0; k < n; k++) {
    instances.push({ id: copyId(k), name: '', def: cloneComposite(template, usedIds), pos: copyPos(k) })
  }
  const fanId = (portId: string, kind: 'fan-in' | 'fan-out'): string => `f-${kind}-${portId.replace(':', '-')}`
  const joinId = (portId: string): string => `j-${portId.replace(':', '-')}`
  if (inputGroupId) instances.push({ id: inputGroupId, name: '', def: { kind: 'builtin', primitive: 'input-port' }, pos: inputPos() })
  if (outputGroupId) instances.push({ id: outputGroupId, name: '', def: { kind: 'builtin', primitive: 'output-port' }, pos: outputPos() })
  for (const node of inputNodes) {
    const idx = inputNodes.indexOf(node)
    if (node.common) {
      instances.push({ id: joinId(node.portId), name: '', def: builtinOf('join-point'), pos: inputSidePos(idx, inputNodes.length) })
    } else {
      instances.push({ id: fanId(node.portId, 'fan-out'), name: '', def: fanOutFork(), pos: inputSidePos(idx, inputNodes.length) })
    }
  }
  for (const p of outIds) {
    if (chainedOutputs.has(p)) continue
    const idx = parallelOutIds.indexOf(p)
    instances.push({ id: fanId(p, 'fan-in'), name: '', def: fanInFork(), pos: fanInPos(idx, parallelOutIds.length) })
  }

  const connections: Connection[] = []
  let counter = 0
  const gen = (): string => `c-${defId}-${++counter}`

  // Parallel (non-chained, non-common) inputs: input-group → fan-out bus → each copy.
  for (const p of inIds) {
    if (chainedInputs.has(p) || commonInputs.has(p)) continue
    if (!inputGroupId) continue
    const fan = fanId(p, 'fan-out')
    connections.push({ id: gen(), from: { instanceId: inputGroupId, portId: p }, to: { instanceId: fan, portId: inputPortId(0) } })
    for (let k = 0; k < n; k++) {
      connections.push({ id: gen(), from: { instanceId: fan, portId: outputPortId(k) }, to: { instanceId: copyId(k), portId: p } })
    }
  }
  // Common inputs: input-group → join-point (NODE) → every copy (the dot fans out).
  for (const p of inIds) {
    if (!commonInputs.has(p)) continue
    if (!inputGroupId) continue
    const node = joinId(p)
    connections.push({ id: gen(), from: { instanceId: inputGroupId, portId: p }, to: { instanceId: node, portId: inputPortId(0) } })
    for (let k = 0; k < n; k++) {
      connections.push({ id: gen(), from: { instanceId: node, portId: outputPortId(0) }, to: { instanceId: copyId(k), portId: p } })
    }
  }
  // Chained inputs feed only copy 0 (single wire).
  for (const p of inIds) {
    if (!chainedInputs.has(p)) continue
    if (!inputGroupId) continue
    connections.push({ id: gen(), from: { instanceId: inputGroupId, portId: p }, to: { instanceId: copyId(0), portId: p } })
  }

  // Non-chained outputs: each copy → fan-in → output-group (fan-in bundles the bus).
  for (const p of outIds) {
    if (chainedOutputs.has(p)) continue
    if (!outputGroupId) continue
    const fan = fanId(p, 'fan-in')
    for (let k = 0; k < n; k++) {
      connections.push({ id: gen(), from: { instanceId: copyId(k), portId: p }, to: { instanceId: fan, portId: inputPortId(k) } })
    }
    connections.push({ id: gen(), from: { instanceId: fan, portId: outputPortId(0) }, to: { instanceId: outputGroupId, portId: p } })
  }
  // Chained outputs are driven by copy n-1 only (single wire).
  for (const p of outIds) {
    if (!chainedOutputs.has(p)) continue
    if (!outputGroupId) continue
    connections.push({ id: gen(), from: { instanceId: copyId(n - 1), portId: p }, to: { instanceId: outputGroupId, portId: p } })
  }

  // Inter-copy chaining.
  for (const chain of chains) {
    for (let k = 0; k < n - 1; k++) {
      connections.push({ id: gen(), from: { instanceId: copyId(k), portId: chain.from }, to: { instanceId: copyId(k + 1), portId: chain.to } })
    }
  }

  return {
    kind: 'composite',
    id: defId,
    name: `${template.name || template.id}-array`,
    ports,
    instances,
    connections,
    arrayConfig: { count: n, chains: chains.map((c) => ({ from: c.from, to: c.to })), orientation, common: [...commonInputs] },
  }
}
