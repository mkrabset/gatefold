import type { Port } from '../types'
import type { Primitive, PropertySpec } from './primitive'

/**
 * The internal `input-port` primitive. A single instance carries all of a composite's
 * input ports (its pins are derived from the parent, acting as sources). Not shown in
 * the library and not independently drawable — the renderer draws the port group.
 */
export class InputPort implements Primitive {
  readonly kind = 'input-port' as const
  readonly label = 'input-port'
  readonly glyph = '▣'
  readonly fixedInputs = true
  readonly fixedOutputs = true
  readonly allowRenameTerminals = false

  defaultPorts(): Port[] {
    return []
  }

  nextInputName(): string | null {
    return null
  }

  isPortGroup(): boolean {
    return true
  }

  isNavigable(): boolean {
    return false
  }

  portGroupDirection(): 'input' {
    return 'input'
  }

  intrinsicWidth(): number {
    return 1
  }

  bodySize(): { w: number; h: number } {
    return { w: 56, h: 28 }
  }

  draw(): void {}

  properties(): PropertySpec[] {
    return []
  }
}
