import { describe, expect, it } from 'vitest'
import type { ChildDef, CompositeDef, Port } from '@gatefold/model'
import { builtinOf, forkOf } from '@gatefold/model'
import { AUTO_CONNECT_RADIUS, computeAutoConnectMatches } from './autoconnect'

const iref = (instanceId: string, portId: string) => ({ instanceId, portId })
const gate = (id: string, kind: Parameters<typeof forkOf>[0], x: number, y: number) => ({ id, name: id, def: forkOf(kind), pos: { x, y } })
const pg = (id: string, kind: 'input-port' | 'output-port', x: number, y: number) => ({ id, name: '', def: builtinOf(kind), pos: { x, y } })

interface Inst {
  id: string
  name: string
  def: ChildDef
  pos: { x: number; y: number }
}

const fanIn = (id: string, n: number, x: number, y: number): Inst => {
  const ports: Port[] = []
  for (let i = 0; i < n; i++) ports.push({ id: `in:${i}`, name: `A${i}`, direction: 'input' })
  ports.push({ id: 'out:0', name: 'BUS', direction: 'output' })
  return { id, name: id, def: { kind: 'fork', primitive: 'fan-in', ports }, pos: { x, y } }
}

function rootOf(
  instances: Inst[],
  ports: Port[] = [],
  connections: { id: string; from: { instanceId: string; portId: string }; to: { instanceId: string; portId: string } }[] = [],
): CompositeDef {
  return { id: 'main', name: 'main', kind: 'composite', ports, instances, connections }
}

describe('computeAutoConnectMatches', () => {
  it('returns nothing with an empty selection', () => {
    const root = rootOf([gate('a', 'and', 0, 0), gate('b', 'buffer', 80, 0)])
    expect(computeAutoConnectMatches(root, root, [])).toEqual([])
  })

  it('matches a selected input to the nearest nearby output', () => {
    const root = rootOf([gate('a', 'and', 0, 0), gate('b', 'buffer', 40, 0)])
    expect(computeAutoConnectMatches(root, root, ['b'])).toEqual([
      { from: iref('a', 'out:0'), to: iref('b', 'in:0') },
    ])
  })

  it('matches a selected output to the nearest nearby unconnected input', () => {
    const root = rootOf([gate('a', 'and', 0, 0), gate('b', 'buffer', 40, 0)])
    expect(computeAutoConnectMatches(root, root, ['a'])).toEqual([
      { from: iref('a', 'out:0'), to: iref('b', 'in:0') },
    ])
  })

  it('ignores terminals beyond the proximity radius', () => {
    const root = rootOf([gate('a', 'and', 0, 0), gate('b', 'buffer', 200, 0)])
    expect(computeAutoConnectMatches(root, root, ['b'])).toEqual([])
  })

  it('picks the closest source when several are in range', () => {
    const root = rootOf([gate('a', 'and', 0, 0), gate('a2', 'and', 25, 0), gate('b', 'buffer', 60, 0)])
    const m = computeAutoConnectMatches(root, root, ['b'])
    expect(m).toEqual([{ from: iref('a2', 'out:0'), to: iref('b', 'in:0') }])
  })

  it('skips an input that is already driven', () => {
    const root = rootOf(
      [gate('a', 'and', 0, 0), gate('b', 'buffer', 40, 0)],
      [],
      [{ id: 'c1', from: iref('a', 'out:0'), to: iref('b', 'in:0') }],
    )
    expect(computeAutoConnectMatches(root, root, ['b'])).toEqual([])
  })

  it('rejects a width-mismatched bus-to-single-wire connection', () => {
    const root = rootOf([fanIn('fi', 2, 0, 0), gate('b', 'buffer', 40, 0)])
    expect(computeAutoConnectMatches(root, root, ['b'])).toEqual([])
  })

  it('never matches a selected instance to itself', () => {
    const root = rootOf([gate('a', 'and', 0, 0)])
    expect(computeAutoConnectMatches(root, root, ['a'])).toEqual([])
  })

  it('matches a selected output to a nearby port-group sink', () => {
    const root = rootOf(
      [pg('out', 'output-port', 0, 0), gate('g', 'and', -50, 0)],
      [{ id: 'out:0', name: 'Y', direction: 'output', terminal: { instanceId: 'out', pinId: 'out:0' } }],
    )
    expect(computeAutoConnectMatches(root, root, ['g'])).toEqual([
      { from: iref('g', 'out:0'), to: iref('out', 'out:0') },
    ])
  })

  it('deduplicates by sink, keeping the closest source (single-driver)', () => {
    const root = rootOf([
      gate('c1', 'clock', -30, 0),
      gate('c2', 'clock', -20, 0),
      gate('b', 'buffer', 0, 0),
    ])
    const m = computeAutoConnectMatches(root, root, ['c1', 'c2'])
    expect(m).toEqual([{ from: iref('c1', 'out:0'), to: iref('b', 'in:0') }])
  })

  it('exposes the proximity radius constant', () => {
    expect(AUTO_CONNECT_RADIUS).toBe(20)
  })
})
