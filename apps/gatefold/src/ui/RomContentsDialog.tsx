import { useEffect, useRef, useState } from 'react'
import type { Instance, ValueFormat } from '@gatefold/model'
import { formatMemoryContents, parseMemoryContents, romAddressWidthOf, romContentsOf, romDataWidthOf, valueFormatOf } from '@gatefold/model'
import { resolveNav, useEditorStore } from '../state/editorStore'
import { useEscapeToClose } from './useDialog'

const FORMATS: ValueFormat[] = ['HEX', 'DEC', 'BINARY']

/**
 * Modal for editing a ROM's memory contents as text. Reads the target instance from
 * `editorStore.romDialog`; the radix dropdown is local (the instance's `valueFormat`
 * only sets the initial radix). Contents are stored canonically as HEX, so switching
 * radices never reinterprets already-stored data. Enter/OK commits, Escape cancels.
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

  const [mode, setMode] = useState<ValueFormat>(initialFormat)
  const [text, setText] = useState(() => {
    const mem = parseMemoryContents(romContentsOf(inst?.props), 'HEX', dw, depth) ?? []
    return formatMemoryContents(mem, initialFormat)
  })
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useEscapeToClose(closeRomDialog)

  useEffect(() => {
    const t = setTimeout(() => textareaRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [])

  if (!inst) return null

  const commit = () => {
    const mem = parseMemoryContents(text, mode, dw, depth)
    if (!mem) {
      setError(`Not a valid ${dw}-bit memory list`)
      return
    }
    setInstanceProp(instanceId, 'contents', formatMemoryContents(mem, 'HEX'))
    closeRomDialog()
  }

  const changeMode = (next: ValueFormat) => {
    const mem = parseMemoryContents(text, mode, dw, depth)
    if (mem) setText(formatMemoryContents(mem, next))
    setError(null)
    setMode(next)
  }

  const loadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setText(await file.text())
    setError(null)
    e.target.value = ''
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
          <select className="dialog-select" value={mode} onChange={(e) => changeMode(e.target.value as ValueFormat)}>
            {FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <textarea
          ref={textareaRef}
          className="dialog-textarea"
          value={text}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value)
            setError(null)
          }}
        />
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
