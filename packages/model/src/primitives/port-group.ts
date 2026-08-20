import type { Port, Signal } from '../types'
import type { Primitive, PropertySpec } from './primitive'

/**
 * Base for the internal `input-port`/`output-port` primitives. A single instance
 * carries all of a composite's input (or output) ports — its pins are derived from the
 * parent (as sources for `input-port`, sinks for `output-port`). Not shown in the
 * library and not independently drawable; the renderer draws the port group.
 */
export abstract class PortGroup implements Primitive {
  abstract readonly kind: 'input-port' | 'output-port'
  abstract readonly label: string
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

  abstract portGroupDirection(): 'input' | 'output'

  intrinsicWidth(): number {
    return 1
  }

  transfer(): Signal[][] {
    // Port groups are netlist wiring, not combinational gates.
    return []
  }

  bodySize(): { w: number; h: number } {
    return { w: 56, h: 28 }
  }

  draw(): void {}

  properties(): PropertySpec[] {
    return []
  }
}
