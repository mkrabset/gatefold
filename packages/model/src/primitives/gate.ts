import type { Port, PrimitiveKind } from '../types'
import type { DrawOptions, Primitive, PropertySpec } from './primitive'
import type { VectorContext } from './vector'

const INPUT_NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

export function countInputs(ports: Port[]): number {
  return ports.filter((p) => p.direction === 'input').length
}

export function countOutputs(ports: Port[]): number {
  return ports.filter((p) => p.direction === 'output').length
}

/**
 * Base class for the single-wire logic gates (AND, OR, XOR, NOT, CLOCK, and the bus
 * FAN-IN/FAN-OUT). Supplies the defaults shared across them: variable inputs named A…
 * H, a fixed single output, no terminal renaming, navigable, width 1.
 */
export abstract class Gate implements Primitive {
  abstract readonly kind: PrimitiveKind
  abstract readonly label: string
  abstract readonly glyph: string
  readonly fixedInputs: boolean = false
  readonly fixedOutputs: boolean = true
  readonly allowRenameTerminals: boolean = false

  abstract defaultPorts(): Port[]
  abstract bodySize(): { w: number; h: number }
  abstract draw(ctx: VectorContext, opts: DrawOptions): void

  nextInputName(ports: Port[]): string | null {
    return INPUT_NAMES[countInputs(ports)] ?? null
  }

  isPortGroup(): boolean {
    return false
  }

  isNavigable(): boolean {
    return true
  }

  portGroupDirection(): 'input' | 'output' | null {
    return null
  }

  intrinsicWidth(_ports: Port[], _port: Port): number {
    return 1
  }

  properties(): PropertySpec[] {
    return []
  }
}
