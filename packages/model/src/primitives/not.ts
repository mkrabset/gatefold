import type { Port } from '../types'
import { inputPortId, outputPortId } from '../types'
import { Buffer } from './buffer'

/** A NOT gate: a buffer whose output terminal is inverted. */
export class NotGate extends Buffer {
  readonly kind = 'not' as const
  readonly label = 'NOT'
  readonly glyph = '1'

  defaultPorts(): Port[] {
    return [
      { id: inputPortId(0), name: 'A', direction: 'input' },
      { id: outputPortId(0), name: 'Y', direction: 'output', inverted: true },
    ]
  }
}
