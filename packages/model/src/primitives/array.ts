import type { Port, PortDirection } from '../types'
import { inputPortId, outputPortId } from '../types'

/** Port list for a switch-array/led-array: `size` single-wire ports, or one bus port. */
export function arrayPorts(direction: PortDirection, terminalType: 'wire' | 'bus', size: number): Port[] {
  if (terminalType === 'bus') {
    const id = direction === 'input' ? inputPortId(0) : outputPortId(0)
    return [{ id, name: 'BUS', direction }]
  }
  const n = Math.max(1, Math.min(32, Math.floor(size)))
  const ports: Port[] = []
  for (let i = 0; i < n; i++) {
    const id = direction === 'input' ? inputPortId(i) : outputPortId(i)
    ports.push({ id, name: direction === 'input' ? `A${i}` : `Y${i}`, direction })
  }
  return ports
}
