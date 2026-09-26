import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Instance, Signal, ValueFormat } from '@gatefold/model'
import { formatMemoryContents, parseMemoryContents, romAddressWidthOf, romContentsOf, romDataWidthOf, valueFormatOf } from '@gatefold/model'
import { resolveNav, useEditorStore } from '../state/editorStore'
import { addrCharCount, applyDigit, formatAddress, formatValue, parseRomText, valueCharCount, valuesPerLineFor } from '../editor/romEditor'
import { useEscapeToClose } from './useDialog'

const FORMATS: ValueFormat[] = ['HEX', 'DEC', 'BINARY']

/** Fixed row height of the editor's monospace lines (mirrors the CSS line-height). */
const ROW_HEIGHT = 18

/** Extra rows rendered beyond the visible window to smooth scrolling. */
const OVERSCAN = 12

/** True when `key` is a printable digit valid for the current radix. */
function isDigitKey(format: ValueFormat, key: string): boolean {
  if (key.length !== 1) return false
  if (format === 'HEX') return /^[0-9a-fA-F]$/.test(key)
  if (format === 'BINARY') return /^[01]$/.test(key)
  return /^[0-9]$/.test(key)
}

/**
 * Modal for editing a ROM's memory contents as an address-prefixed grid. Each line is
 * `ADDR val val …` in the selected radix, zero-padded; addresses are read-only. A
 * single-digit cursor (over the value fields only) is overwritten on typing. Contents
 * are stored canonically as HEX, so the radix is display/entry only.
 */
export function RomContentsDialog() {
  const romDialog = useEditorStore((s) => s.romDialog)
  if (!romDialog) return null
  return <RomContentsForm key={romDialog.instanceId} instanceId={romDialog.instanceId} />
}

function RomContentsForm({ instanceId }: { instanceId: string }) {
  const design = useEditorStore((s) => s.design)
  const navStack = useEditorStore((s) => s.navStack)
  const closeRomDialog = useEditorStore((s) => s.closeRomDialog)
  const setInstanceProp = useEditorStore((s) => s.setInstanceProp)

  const current = resolveNav(design, navStack)
  const inst: Instance | undefined =
    current && current.kind === 'composite' ? current.instances.find((i) => i.id === instanceId) : undefined

  const aw = romAddressWidthOf(inst?.props)
  const dw = romDataWidthOf(inst?.props)
  const depth = 1 << aw
  const initialFormat = valueFormatOf(inst?.props)

  const [format, setFormat] = useState<ValueFormat>(initialFormat)
  const [mem, setMem] = useState<Signal[][]>(() => parseMemoryContents(romContentsOf(inst?.props), 'HEX', dw, depth) ?? [])
  const [cursor, setCursor] = useState<{ word: number; digit: number }>({ word: 0, digit: 0 })
  const [error, setError] = useState<string | null>(null)
  const [availableChars, setAvailableChars] = useState(24)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewHeight, setViewHeight] = useState(260)
  const containerRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  useEscapeToClose(closeRomDialog)

  // Measure the editor's usable width (in monospace characters) and height.
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      const style = getComputedStyle(el)
      const ctx = document.createElement('canvas').getContext('2d')
      const charW = ctx ? (ctx.font = style.font, ctx.measureText('0').width) : 7.2
      const inner = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      setAvailableChars(Math.max(1, Math.floor(inner / Math.max(1, charW))))
      setViewHeight(el.clientHeight)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Focus the editor once it opens.
  useEffect(() => {
    const t = setTimeout(() => containerRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [])

  const addrChars = addrCharCount(format, aw)
  const valueChars = valueCharCount(format, dw)
  const vpl = valuesPerLineFor(availableChars, addrChars, valueChars)
  const rowCount = Math.ceil(depth / vpl)

  // Keep the cursor row in view after any cursor move.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const top = Math.floor(cursor.word / vpl) * ROW_HEIGHT
    const bottom = top + ROW_HEIGHT
    if (top < el.scrollTop) el.scrollTop = top
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
  }, [cursor, vpl])

  if (!inst) return null

  const move = (word: number, digit: number): void => {
    setCursor({
      word: Math.max(0, Math.min(depth - 1, word)),
      digit: Math.max(0, Math.min(valueChars - 1, digit)),
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const { word, digit } = cursor
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      if (digit > 0) move(word, digit - 1)
      else if (word > 0) move(word - 1, valueChars - 1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      if (digit < valueChars - 1) move(word, digit + 1)
      else if (word < depth - 1) move(word + 1, 0)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      move(word - vpl, digit)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      move(word + vpl, digit)
    } else if (e.key === 'Home') {
      e.preventDefault()
      move(word, 0)
    } else if (e.key === 'End') {
      e.preventDefault()
      move(word, valueChars - 1)
    } else if (e.key === 'Backspace') {
      e.preventDefault()
      if (digit > 0) move(word, digit - 1)
      else if (word > 0) move(word - 1, valueChars - 1)
    } else if (e.key === 'Delete') {
      e.preventDefault()
      if (digit < valueChars - 1) move(word, digit + 1)
      else if (word < depth - 1) move(word + 1, 0)
    } else if (isDigitKey(format, e.key)) {
      e.preventDefault()
      const target = cursor
      setMem((m) => {
        const next = m.slice()
        next[target.word] = applyDigit(m[target.word], format, dw, target.digit, e.key)
        return next
      })
      if (digit < valueChars - 1) move(word, digit + 1)
      else if (word < depth - 1) move(word + 1, 0)
    }
  }

  const commit = (): void => {
    setInstanceProp(instanceId, 'contents', formatMemoryContents(mem, 'HEX'))
    closeRomDialog()
  }

  const changeFormat = (next: ValueFormat): void => {
    setFormat(next)
    setCursor((c) => ({ word: c.word, digit: 0 }))
    setError(null)
  }

  const loadFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const parsed = parseRomText(await file.text(), format, dw, depth)
    if (!parsed) {
      setError(`Not a valid ${dw}-bit memory file`)
      return
    }
    setMem(parsed)
    setCursor({ word: 0, digit: 0 })
    setError(null)
  }

  const firstRow = Math.floor(scrollTop / ROW_HEIGHT)
  const lastRow = Math.min(rowCount, Math.ceil((scrollTop + viewHeight) / ROW_HEIGHT) + OVERSCAN)
  const rows: { index: number; start: number; words: Signal[][] }[] = []
  for (let r = firstRow; r < lastRow; r++) {
    const start = r * vpl
    rows.push({ index: r, start, words: mem.slice(start, Math.min(depth, start + vpl)) })
  }

  return (
    <div
      className="dialog-overlay"
      onClick={closeRomDialog}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) e.preventDefault()
      }}
    >
      <div className="dialog rom-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title dialog-title-row">
          <span>
            ROM contents — {depth} × {dw} bits in
          </span>
          <select className="dialog-select" value={format} onChange={(e) => changeFormat(e.target.value as ValueFormat)}>
            {FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <div
          ref={containerRef}
          className="rom-editor"
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
        >
          <div style={{ height: firstRow * ROW_HEIGHT }} />
          {rows.map((row) => (
            <div className="rom-row" key={row.index} style={{ height: ROW_HEIGHT }}>
              <span className="rom-addr">{formatAddress(row.start, format, aw)}</span>
              {row.words.map((word, i) => {
                const absWord = row.start + i
                const text = formatValue(word, format, dw)
                return (
                  <span className="rom-word" key={i}>
                    {' '}
                    {text.split('').map((ch, d) => (
                      <span
                        key={d}
                        className={`rom-digit${cursor.word === absWord && cursor.digit === d ? ' cursor' : ''}`}
                        onClick={() => setCursor({ word: absWord, digit: d })}
                      >
                        {ch}
                      </span>
                    ))}
                  </span>
                )
              })}
            </div>
          ))}
          <div style={{ height: (rowCount - lastRow) * ROW_HEIGHT }} />
        </div>
        {error && <div className="dialog-error">{error}</div>}
        <div className="dialog-actions">
          <button type="button" className="dialog-btn" style={{ marginRight: 'auto' }} onClick={() => fileRef.current?.click()}>
            Load file…
          </button>
          <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={loadFile} />
          <button type="button" className="dialog-btn" onClick={closeRomDialog}>
            Cancel
          </button>
          <button type="button" className="dialog-btn primary" onClick={commit}>
            OK
          </button>
        </div>
      </div>
    </div>
  )
}
