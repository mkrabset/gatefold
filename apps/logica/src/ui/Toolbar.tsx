import { useRef } from 'react'
import { useEditorStore } from '../state/editorStore'
import { useUiStore } from '../state/uiStore'
import { useSimStore } from '../state/simStore'

/**
 * Top toolbar: brand, group action, simulation controls (placeholders), breadcrumb
 * navigation, JSON save/load (placeholders), and theme toggle. Buttons are dumb
 * presenters that call into the stores.
 */

function IconButton(props: {
  title: string
  active?: boolean
  disabled?: boolean
  onClick?: () => void
  children: React.ReactNode
}) {
  return (
    <button
      className={`tb-btn${props.active ? ' active' : ''}`}
      title={props.title}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.children}
    </button>
  )
}

const PlayIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M4 2.5v11l9-5.5z" />
  </svg>
)
const StepIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M4 2.5v11l5-5.5zM11 2.5h2v11h-2z" />
  </svg>
)
const StopIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <rect x="3" y="3" width="10" height="10" rx="1" />
  </svg>
)
const ResetIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 3a5 5 0 1 0 5 5h-2a3 3 0 1 1-3-3v2l4-3-4-3z" />
  </svg>
)

const SunIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M13 3l-1.5 1.5M4.5 11.5L3 13" />
  </svg>
)

const MoonIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
    <path d="M13.5 9.5A6 6 0 1 1 6.5 2.5a5 5 0 0 0 7 7z" />
  </svg>
)

const GroupIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="2" y="3" width="7" height="7" rx="1" />
    <rect x="7" y="6" width="7" height="7" rx="1" />
  </svg>
)

export function Toolbar() {
  const navigateUp = useEditorStore((s) => s.navigateUp)
  const navStack = useEditorStore((s) => s.navStack)
  const design = useEditorStore((s) => s.design)
  const theme = useUiStore((s) => s.theme)
  const toggleTheme = useUiStore((s) => s.toggleTheme)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const openGroupDialog = useEditorStore((s) => s.openGroupDialog)
  const saveProject = useEditorStore((s) => s.saveProject)
  const loadProject = useEditorStore((s) => s.loadProject)
  const fileRef = useRef<HTMLInputElement>(null)
  const mode = useSimStore((s) => s.mode)
  const running = useSimStore((s) => s.running)
  const toggleMode = useSimStore((s) => s.toggleMode)
  const run = useSimStore((s) => s.run)
  const step = useSimStore((s) => s.step)
  const stop = useSimStore((s) => s.stop)
  const reset = useSimStore((s) => s.reset)
  const ascend = useSimStore((s) => s.ascend)

  const onOpenFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    loadProject(await file.text())
    e.target.value = ''
  }

  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark">L</span>
        <span className="brand-name">logica</span>
      </div>

      <div className="tb-divider" />

      <IconButton title="Group into component" disabled={selectedIds.length === 0} onClick={openGroupDialog}>
        <GroupIcon />
      </IconButton>

      <div className="tb-divider" />

      <IconButton title={mode === 'simulate' ? 'Exit simulation' : 'Simulate'} active={mode === 'simulate'} onClick={toggleMode}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M8 1v6" />
          <path d="M5.5 3.5a5 5 0 1 0 5 0" />
        </svg>
      </IconButton>

      <div className="tb-divider" />

      <div className="tb-group">
        <IconButton title="Run" active={running} onClick={run}>
          <PlayIcon />
        </IconButton>
        <IconButton title="Step" onClick={step}>
          <StepIcon />
        </IconButton>
        <IconButton title="Stop" onClick={stop}>
          <StopIcon />
        </IconButton>
        <IconButton title="Reset" onClick={reset}>
          <ResetIcon />
        </IconButton>
      </div>

      <div className="tb-divider" />

      <div className="breadcrumb">
        {navStack.map((id, i) => {
          const def = design.defs[id]
          const name = def?.name ?? id
          const isLast = i === navStack.length - 1
          // Mark library templates (not the root, not an instance copy).
          const isTemplate = !!def && def.variant !== true && id !== design.root
          return (
            <span key={id} className="crumb">
              {i > 0 && <span className="crumb-sep">/</span>}
              {isLast ? <span className="crumb-current">{name}</span> : <span className="crumb-link">{name}</span>}
              {isTemplate && <span className="crumb-kind">template</span>}
            </span>
          )
        })}
        {navStack.length > 1 && (
          <button
            className="crumb-up"
            title="Up one level"
            onClick={() => {
              navigateUp()
              if (mode === 'simulate') ascend()
            }}
          >
            ↑
          </button>
        )}
      </div>

      <div className="tb-spacer" />

      <div className="tb-group">
        <IconButton title="Open JSON" onClick={() => fileRef.current?.click()}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8 11V3M8 3L5 6M8 3l3 3M3 11v2h10v-2" />
          </svg>
        </IconButton>
        <IconButton title="Save JSON" onClick={saveProject}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8 3v8M8 11l-3-3M8 11l3-3M3 13h10" />
          </svg>
        </IconButton>
      </div>

      <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onOpenFile} />

      <IconButton title="Toggle theme" onClick={toggleTheme}>
        {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
      </IconButton>
    </header>
  )
}
