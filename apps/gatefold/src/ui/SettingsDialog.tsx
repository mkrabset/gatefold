import { useState } from 'react'
import { DEFAULT_LANE_DISTANCE, useUiStore } from '../state/uiStore'
import type { HistoryLimitMode } from '@gatefold/sim'
import { useEscapeToClose } from './useDialog'

/**
 * Global settings modal. Hosts the bus-lane spacing ("lane distance"), the simulation
 * history size, and the history-limit behaviour. Values commit on blur/Enter so typing
 * doesn't re-layout the canvas (or rebuild the simulator) on every keystroke.
 */
export function SettingsDialog() {
  const open = useUiStore((s) => s.settingsOpen)
  const laneDistance = useUiStore((s) => s.laneDistance)
  const maxHistoryEvents = useUiStore((s) => s.maxHistoryEvents)
  const historyLimitMode = useUiStore((s) => s.historyLimitMode)
  const setLaneDistance = useUiStore((s) => s.setLaneDistance)
  const setMaxHistoryEvents = useUiStore((s) => s.setMaxHistoryEvents)
  const setHistoryLimitMode = useUiStore((s) => s.setHistoryLimitMode)
  const closeSettings = useUiStore((s) => s.closeSettings)
  const [distance, setDistance] = useState(String(laneDistance))
  const [maxEvents, setMaxEvents] = useState(String(maxHistoryEvents))
  useEscapeToClose(closeSettings, open)

  if (!open) return null

  const commit = () => {
    const n = Number(distance)
    if (Number.isFinite(n) && n >= 0) setLaneDistance(n)
    else setDistance(String(laneDistance))
  }

  const commitMaxEvents = () => {
    const n = Number(maxEvents)
    if (Number.isFinite(n) && n >= 1) setMaxHistoryEvents(n)
    else setMaxEvents(String(maxHistoryEvents))
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
        <div className="dialog-section">
          <div className="dialog-section-title">Max simulation history (events)</div>
          <input
            className="dialog-input"
            type="number"
            min={1}
            step={1}
            value={maxEvents}
            onChange={(e) => setMaxEvents(e.target.value)}
            onBlur={commitMaxEvents}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitMaxEvents()
                e.currentTarget.blur()
              }
            }}
          />
        </div>
        <div className="dialog-section">
          <div className="dialog-section-title">History limit</div>
          <select
            className="dialog-input"
            value={historyLimitMode}
            onChange={(e) => setHistoryLimitMode(e.target.value as HistoryLimitMode)}
          >
            <option value="stop">Stop simulation</option>
            <option value="sliding">Sliding ring buffer</option>
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
