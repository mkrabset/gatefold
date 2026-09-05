import { useEffect, useRef, useState } from 'react'
import type { Signal, ValueFormat } from '@gatefold/model'
import { applyValueOrder, formatSwitchValue, parseSwitchValue } from '@gatefold/model'
import { useSimStore } from '../state/simStore'

/**
 * Modal for entering a numeric value into a switch-array. Reads the target from
 * `simStore.switchDialog`; the radix dropdown is local to this dialog (changing it only
 * affects parsing here), and the instance's `order` is applied but not shown. Enter
 * commits and closes; Escape cancels without altering the switches.
 */
export function SwitchValueDialog() {
  const dialog = useSimStore((s) => s.switchDialog)
  if (!dialog) return null
  return <SwitchValueForm key={`${dialog.instanceId}:${dialog.size}`} dialog={dialog} />
}

function SwitchValueForm({
  dialog,
}: {
  dialog: { instanceId: string; size: number; lanes: Signal[]; format: ValueFormat; order: 'asc' | 'desc' }
}) {
  const setSwitchValue = useSimStore((s) => s.setSwitchValue)
  const closeSwitchDialog = useSimStore((s) => s.closeSwitchDialog)
  const [mode, setMode] = useState<ValueFormat>(dialog.format)
  const [text, setText] = useState(() => formatSwitchValue(applyValueOrder(dialog.lanes, dialog.order), dialog.format))
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus the input (with the current value selected) so typing replaces it right away.
  // Deferred past the opening click gesture: the dialog opens on the canvas `pointerdown`,
  // and the browser's subsequent mouse-up/click moves focus to <body>, which would
  // otherwise steal it back after the synchronous focus here.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    const t = setTimeout(() => {
      el.focus()
      el.select()
    }, 0)
    return () => clearTimeout(t)
  }, [])

  const commit = () => {
    const bits = parseSwitchValue(text, mode, dialog.size)
    if (!bits) {
      setError(`Not a valid ${dialog.size}-bit value`)
      return
    }
    setSwitchValue(dialog.instanceId, applyValueOrder(bits, dialog.order))
  }

  const changeMode = (next: ValueFormat) => {
    // Convert the current value (parsed in the old radix) into the new radix, when valid.
    const bits = parseSwitchValue(text, mode, dialog.size)
    if (bits) {
      setText(formatSwitchValue(bits, next))
      setError(null)
    }
    setMode(next)
  }

  return (
    <div
      className="dialog-overlay"
      onClick={closeSwitchDialog}
      onMouseDown={(e) => {
        // Clicking the backdrop (which closes the dialog anyway) must not steal focus
        // from the input; leave the select/input/buttons inside alone.
        if (e.target === e.currentTarget) e.preventDefault()
      }}
    >
      <div
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            closeSwitchDialog()
          }
        }}
      >
        <div className="dialog-title dialog-title-row">
          <span>enter {dialog.size}-bit value in</span>
          <select className="dialog-select" value={mode} onChange={(e) => changeMode(e.target.value as ValueFormat)}>
            <option value="HEX">HEX</option>
            <option value="DEC">DEC</option>
            <option value="SIGNED DEC">SIGNED DEC</option>
          </select>
        </div>
        <input
          ref={inputRef}
          className="dialog-input"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
          }}
          spellCheck={false}
        />
        {error && <div className="dialog-error">{error}</div>}
        <div className="dialog-actions">
          <button type="button" className="dialog-btn" onClick={closeSwitchDialog}>
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
