import { useState } from 'react'
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

  const commit = () => {
    const bits = parseSwitchValue(text, mode, dialog.size)
    if (!bits) {
      setError(`Not a valid ${dialog.size}-bit value`)
      return
    }
    setSwitchValue(dialog.instanceId, applyValueOrder(bits, dialog.order))
  }

  return (
    <div className="dialog-overlay" onClick={closeSwitchDialog}>
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
          <select className="dialog-select" value={mode} onChange={(e) => setMode(e.target.value as ValueFormat)}>
            <option value="HEX">HEX</option>
            <option value="DEC">DEC</option>
            <option value="SIGNED DEC">SIGNED DEC</option>
          </select>
        </div>
        <input
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
          autoFocus
          onFocus={(e) => e.target.select()}
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
