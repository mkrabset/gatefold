import { useEditorStore } from '../state/editorStore'
import { useUiStore } from '../state/uiStore'
import type { Tool } from '../state/editorStore'

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

function ToolButton({ tool, active, onClick, children }: { tool: Tool; active: boolean; onClick: (t: Tool) => void; children: React.ReactNode }) {
  return (
    <button className={`tb-btn${active ? ' active' : ''}`} onClick={() => onClick(tool)}>
      {children}
    </button>
  )
}

const SelectIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M2 2l5 12 1.5-4.5L13 8z" />
  </svg>
)
const WireIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M2 13L8 7M8 7l6-6" />
    <circle cx="2" cy="13" r="2" />
    <circle cx="14" cy="1" r="2" />
  </svg>
)
const PanIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.5" />
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
  const tool = useEditorStore((s) => s.tool)
  const setTool = useEditorStore((s) => s.setTool)
  const navigateUp = useEditorStore((s) => s.navigateUp)
  const navStack = useEditorStore((s) => s.navStack)
  const design = useEditorStore((s) => s.design)
  const theme = useUiStore((s) => s.theme)
  const toggleTheme = useUiStore((s) => s.toggleTheme)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const openGroupDialog = useEditorStore((s) => s.openGroupDialog)

  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark">L</span>
        <span className="brand-name">logica</span>
      </div>

      <div className="tb-group">
        <ToolButton tool="select" active={tool === 'select'} onClick={setTool}>
          <SelectIcon />
        </ToolButton>
        <ToolButton tool="wire" active={tool === 'wire'} onClick={setTool}>
          <WireIcon />
        </ToolButton>
        <ToolButton tool="pan" active={tool === 'pan'} onClick={setTool}>
          <PanIcon />
        </ToolButton>
      </div>

      <div className="tb-divider" />

      <IconButton title="Group into component" disabled={selectedIds.length < 2} onClick={openGroupDialog}>
        <GroupIcon />
      </IconButton>

      <div className="tb-divider" />

      <div className="tb-group">
        <IconButton title="Run" active>
          <PlayIcon />
        </IconButton>
        <IconButton title="Step">
          <StepIcon />
        </IconButton>
        <IconButton title="Stop">
          <StopIcon />
        </IconButton>
        <IconButton title="Reset">
          <ResetIcon />
        </IconButton>
      </div>

      <div className="tb-divider" />

      <div className="breadcrumb">
        {navStack.map((id, i) => {
          const name = design.defs[id]?.name ?? id
          const isLast = i === navStack.length - 1
          return (
            <span key={id} className="crumb">
              {i > 0 && <span className="crumb-sep">/</span>}
              {isLast ? <span className="crumb-current">{name}</span> : <span className="crumb-link">{name}</span>}
            </span>
          )
        })}
        {navStack.length > 1 && (
          <button className="crumb-up" title="Up one level" onClick={navigateUp}>
            ↑
          </button>
        )}
      </div>

      <div className="tb-spacer" />

      <div className="tb-group">
        <IconButton title="Open JSON">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8 11V3M8 3L5 6M8 3l3 3M3 11v2h10v-2" />
          </svg>
        </IconButton>
        <IconButton title="Save JSON">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8 3v8M8 11l-3-3M8 11l3-3M3 13h10" />
          </svg>
        </IconButton>
      </div>

      <IconButton title="Toggle theme" onClick={toggleTheme}>
        {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
      </IconButton>
    </header>
  )
}
