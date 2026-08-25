import { useState } from 'react'
import { useSimStore } from '../state/simStore'

/**
 * Modal for simulation settings: default gate delay (ps) and the step mode. The delay
 * commits on blur/Enter (so typing doesn't re-run the sim on every keystroke).
 */
export function SimSettingsDialog() {
  const open = useSimStore((s) => s.settingsOpen)
  const defaultDelay = useSimStore((s) => s.defaultDelay)
  const stepMode = useSimStore((s) => s.stepMode)
  const setStepMode = useSimStore((s) => s.setStepMode)
  const setDefaultDelay = useSimStore((s) => s.setDefaultDelay)
  const closeSettings = useSimStore((s) => s.closeSettings)
  const [delay, setDelay] = useState(String(defaultDelay))

  if (!open) return null

  const commitDelay = () => {
    const n = Number(delay)
    if (Number.isFinite(n) && n >= 1) setDefaultDelay(n)
    else setDelay(String(defaultDelay))
  }

  return (
    <div className="dialog-overlay" onClick={closeSettings}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">Simulation settings</div>
        <div className="dialog-section">
          <div className="dialog-section-title">Gate delay (ps)</div>
          <input
            className="dialog-input"
            type="number"
            min={1}
            value={delay}
            onChange={(e) => setDelay(e.target.value)}
            onBlur={commitDelay}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitDelay()
                e.currentTarget.blur()
              }
            }}
          />
        </div>
        <div className="dialog-section">
          <div className="dialog-section-title">Step mode</div>
          <select
            className="dialog-input"
            value={stepMode}
            onChange={(e) => setStepMode(e.target.value as 'quiescent' | 'clock-edge')}
          >
            <option value="quiescent">Settle to quiescence</option>
            <option value="clock-edge">Advance one clock edge</option>
          </select>
        </div>
        <div className="dialog-actions">
          <button className="dialog-btn primary" onClick={closeSettings}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
