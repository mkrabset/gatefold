import type { Port, PropertyValue, Signal } from '../types'
import { inputPortId, outputPortId } from '../ports'
import { parseMemoryContents } from '../value'
import { Gate, gateBounds } from './gate'
import type { DrawOptions, PropertySpec } from './primitive'
import type { VectorContext } from './vector'

/** Default address-bus width (bits). */
export const ROM_DEFAULT_ADDRESS_WIDTH = 8

/** Maximum address-bus width (bits) — bounds the memory to 2^16 = 65 536 words. */
export const ROM_MAX_ADDRESS_WIDTH = 16

/** Default data-bus width (bits). */
export const ROM_DEFAULT_DATA_WIDTH = 8

/** Maximum data-bus width (bits). */
export const ROM_MAX_DATA_WIDTH = 64

/** Resolve a ROM's address-bus width from its `busWidth` property, clamped to `[1, 16]`. */
export function romAddressWidthOf(props: Record<string, PropertyValue> | undefined): number {
  const w = typeof props?.busWidth === 'number' ? Math.floor(props.busWidth) : ROM_DEFAULT_ADDRESS_WIDTH
  return Math.max(1, Math.min(ROM_MAX_ADDRESS_WIDTH, w))
}

/** Resolve a ROM's data-bus width from its `dataWidth` property, clamped to `[1, 64]`. */
export function romDataWidthOf(props: Record<string, PropertyValue> | undefined): number {
  const w = typeof props?.dataWidth === 'number' ? Math.floor(props.dataWidth) : ROM_DEFAULT_DATA_WIDTH
  return Math.max(1, Math.min(ROM_MAX_DATA_WIDTH, w))
}

/** The stored memory contents text (canonical HEX; empty = all-zero). */
export function romContentsOf(props: Record<string, PropertyValue> | undefined): string {
  return typeof props?.contents === 'string' ? props.contents : ''
}

/** An address vector's numeric index (`bits[0]` = least-significant), LSB-first. */
function indexOfAddress(addr: Signal[]): number {
  let index = 0
  for (let i = 0; i < addr.length; i++) if (addr[i] === 1) index |= 1 << i
  return index
}

/**
 * A read-only memory: a configurable-width address bus in (`ADDR`) and data bus out
 * (`DATA`). A purely combinational, asynchronous read — `DATA = mem[ADDR]` after the
 * engine's configured gate delay, with no address latching or clock. Any `x` address
 * bit yields all-`x` data; addresses beyond the stored contents read `0`. The stored
 * memory is `props.contents` (a canonical HEX word list, one per address) and
 * `props.valueFormat` is only the entry/display radix. Exports to Verilog as an
 * inferred memory (`reg mem[]` + `initial` + `assign DATA = mem[ADDR]`), leaving the
 * RAM-vs-LUT choice to the synthesis toolchain.
 */
export class Rom extends Gate {
  readonly kind = 'rom' as const
  readonly label = 'ROM'
  readonly glyph = 'ROM'
  readonly fixedInputs = true
  readonly fixedOutputs = true

  defaultPorts(): Port[] {
    return [
      { id: inputPortId(0), name: 'ADDR', direction: 'input' },
      { id: outputPortId(0), name: 'DATA', direction: 'output' },
    ]
  }

  nextInputName(): string | null {
    return null
  }

  showTerminalNames(): boolean {
    return true
  }

  properties(): PropertySpec[] {
    return [
      { name: 'busWidth', label: 'Address width', type: 'number', default: ROM_DEFAULT_ADDRESS_WIDTH, min: 1, max: ROM_MAX_ADDRESS_WIDTH, tooltip: 'Number of address bits (the memory holds 2^width words).' },
      { name: 'dataWidth', label: 'Data width', type: 'number', default: ROM_DEFAULT_DATA_WIDTH, min: 1, max: ROM_MAX_DATA_WIDTH, tooltip: 'Number of data bits per word.' },
      { name: 'valueFormat', label: 'Value format', type: 'select', default: 'HEX', options: ['HEX', 'DEC', 'BINARY'], tooltip: 'Radix used to enter/display the memory contents in the editor dialog.' },
    ]
  }

  intrinsicWidth(_ports: Port[], port: Port, props?: Record<string, PropertyValue>): number {
    return port.direction === 'input' ? romAddressWidthOf(props) : romDataWidthOf(props)
  }

  transfer(inputs: Signal[][], props?: Record<string, PropertyValue>): Signal[][] {
    const addr = inputs[0] ?? []
    const dataWidth = romDataWidthOf(props)
    const addressWidth = romAddressWidthOf(props)
    const zeros = Array.from({ length: dataWidth }, () => 0 as Signal)
    if (addr.some((b) => b === 'x')) return [Array.from({ length: dataWidth }, () => 'x' as Signal)]
    const mem = parseMemoryContents(romContentsOf(props), 'HEX', dataWidth, 1 << addressWidth)
    return [mem?.[indexOfAddress(addr)] ?? zeros]
  }

  bodySize(): { w: number; h: number } {
    // Wide enough for the ADDR/DATA terminal labels (drawn inside, beside the pins)
    // to sit on the same line without overlapping.
    return { w: 76, h: 48 }
  }

  draw(ctx: VectorContext, opts: DrawOptions): void {
    const { l, r, t, b, cx, cy } = gateBounds(opts)
    ctx.beginPath()
    ctx.roundRect(l, t, r - l, b - t, 6)
    ctx.fill(opts.palette.gateFill)
    ctx.stroke(opts.palette.gateStroke, 1.5)
    // A 2x2 memory-cell grid centred in the body reads as a memory chip.
    const s = 4
    const gap = 3
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        ctx.beginPath()
        ctx.roundRect(cx - s - gap / 2 + col * (s + gap), cy - s - gap / 2 + row * (s + gap), s, s, 1)
        ctx.fill(opts.palette.pin)
      }
    }
  }
}
