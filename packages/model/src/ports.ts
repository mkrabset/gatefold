import type { Port, PortDirection } from './types'

/** The id of the `index`-th input terminal (`in:0`, `in:1`, …). */
export const inputPortId = (index: number) => `in:${index}`

/** The id of the `index`-th output terminal (`out:0`, `out:1`, …). */
export const outputPortId = (index: number) => `out:${index}`

/** A definition's input ports (in declared order). */
export function inputPorts(ports: Port[]): Port[] {
  return ports.filter((p) => p.direction === 'input')
}

/** A definition's output ports (in declared order). */
export function outputPorts(ports: Port[]): Port[] {
  return ports.filter((p) => p.direction === 'output')
}

/**
 * Produce a fresh, unused port id of the given direction. Used by the ports editor
 * so that added ports never collide with existing ids (which may have gaps after
 * removals).
 */
export function nextPortId(ports: Port[], direction: PortDirection): string {
  const prefix = direction === 'input' ? 'in' : 'out'
  const used = ports
    .filter((p) => p.direction === direction)
    .map((p) => {
      const idx = Number(p.id.split(':')[1])
      return Number.isFinite(idx) ? idx : -1
    })
  let i = 0
  while (used.includes(i)) i++
  return `${prefix}:${i}`
}
