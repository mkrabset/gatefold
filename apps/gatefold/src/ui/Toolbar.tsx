import { useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { resolveNav, useEditorStore } from '../state/editorStore'
import { useUiStore } from '../state/uiStore'
import { useSimStore } from '../state/simStore'
import { childLabel } from '@gatefold/model'

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

const BookmarkIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M4.5 2.5h7v11l-3.5-2.5-3.5 2.5z" />
  </svg>
)

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.5 9.5h7L12 4M6.5 6.5v4.5M9.5 6.5v4.5" />
  </svg>
)

const LinkIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M6.5 9.5 9.5 6.5" />
    <path d="M7 11 4.5 13.5a2.5 2.5 0 0 1-3.5-3.5L3.5 7.5a2.5 2.5 0 0 1 3.5 0" />
    <path d="M9 5l2.5-2.5a2.5 2.5 0 0 1 3.5 3.5L12.5 8.5a2.5 2.5 0 0 1-3.5 0" />
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
  const exportVerilog = useEditorStore((s) => s.exportVerilog)
  const saveDefault = useEditorStore((s) => s.saveDefault)
  const clearDefault = useEditorStore((s) => s.clearDefault)
  const copyLink = useEditorStore((s) => s.copyLink)
  const fileRef = useRef<HTMLInputElement>(null)
  const mode = useSimStore((s) => s.mode)
  const running = useSimStore((s) => s.running)
  const timing = useSimStore(
    useShallow((s) => {
      if (s.mode !== 'simulate' || !s.engine) return { active: false, half: false, full: false }
      return { active: s.engine.hasSingleClock(), half: s.engine.timingHalfViolation, full: s.engine.timingFullViolation }
    }),
  )
  const toggleMode = useSimStore((s) => s.toggleMode)
  const run = useSimStore((s) => s.run)
  const step = useSimStore((s) => s.step)
  const stop = useSimStore((s) => s.stop)
  const reset = useSimStore((s) => s.reset)
  const ascend = useSimStore((s) => s.ascend)
  const openSettings = useSimStore((s) => s.openSettings)

  const onOpenFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    loadProject(await file.text())
    e.target.value = ''
  }

  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark">G</span>
        <span className="brand-name">gatefold</span>
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
        <IconButton title="Simulation settings" onClick={openSettings}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="8" cy="8" r="2.2" />
            <path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6 11 5M5 11l-1.4 1.4" />
          </svg>
        </IconButton>
      </div>

      {timing.active && (
        <span
          className={`timing-lamp${timing.full ? ' full' : timing.half ? ' half' : ''}`}
          title={
            timing.full
              ? 'Clock too fast — logic does not settle within one clock period'
              : timing.half
                ? 'Clock too fast — logic does not settle before the next clock edge (half period)'
                : 'Timing OK — logic settles within half a clock period'
          }
        />
      )}

      <div className="tb-divider" />

      <div className="breadcrumb">
        {navStack.map((step, i) => {
          const isLast = i === navStack.length - 1
          let name: string
          let isTemplate = false
          if (step.kind === 'root') {
            name = design.root.name
          } else if (step.kind === 'template') {
            name = design.library[step.id]?.name ?? step.id
            isTemplate = true
          } else {
            const parent = resolveNav(design, navStack.slice(0, i))
            const inst = parent && parent.kind === 'composite' ? parent.instances.find((x) => x.id === step.id) : undefined
            name = inst ? childLabel(inst.def) : step.id
          }
          return (
            <span key={i} className="crumb">
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
        <IconButton title="Export Verilog" onClick={exportVerilog}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 3h8M4 3v2M4 3l-1 2M12 3v2M12 3l1 2M3 13h10M4 8h8M6 8v5M10 8v5" />
          </svg>
        </IconButton>
        <IconButton title="Copy link" onClick={copyLink}>
          <LinkIcon />
        </IconButton>
      </div>

      <div className="tb-group">
        <IconButton title="Save as default" onClick={saveDefault}>
          <BookmarkIcon />
        </IconButton>
        <IconButton title="Clear default" onClick={clearDefault}>
          <TrashIcon />
        </IconButton>
      </div>

      <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onOpenFile} />

      <IconButton title="Toggle theme" onClick={toggleTheme}>
        {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
      </IconButton>

      <span className="tb-copyright">(C) Marius Krabset 2026</span>
    </header>
  )
}
