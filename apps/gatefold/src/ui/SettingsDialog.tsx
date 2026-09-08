import { useState } from 'react'
import { DEFAULT_LANE_DISTANCE, useUiStore } from '../state/uiStore'

/**
 * Global settings modal. Currently hosts a single setting — the bus-lane spacing
 * ("lane distance", in world units) — which controls how far apart the individual wires
 * of a bus terminal are drawn, so large buses can take less vertical space. Commits on
 * blur/Enter so typing doesn't re-layout the canvas on every keystroke.
 */
export function SettingsDialog() {
  const open = useUiStore((s) => s.settingsOpen)
  const laneDistance = useUiStore((s) => s.laneDistance)
  const setLaneDistance = useUiStore((s) => s.setLaneDistance)
  const closeSettings = useUiStore((s) => s.closeSettings)
  const [distance, setDistance] = useState(String(laneDistance))

  if (!open) return null

  const commit = () => {
    const n = Number(distance)
    if (Number.isFinite(n) && n >= 0) setLaneDistance(n)
    else setDistance(String(laneDistance))
  }

  return (
    <div className="dialog-overlay" onClick={closeSettings}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">Settings</div>
        <div className="dialog-section">
          <div className="dialog-section-title">Lane distance (0–{DEFAULT_LANE_DISTANCE})</div>
          <input
            className="dialog-input"
            type="number"
            min={0}
            max={DEFAULT_LANE_DISTANCE}
            step={0.1}
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit()
                e.currentTarget.blur()
              }
            }}
          />
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
