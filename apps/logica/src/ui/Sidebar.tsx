import { useState } from 'react'
import { currentDefId, useEditorStore } from '../state/editorStore'
import type { ComponentDef, Instance } from '@logica/model'

interface TreeItemProps {
  label: string
  depth: number
  icon?: string
  kind?: string
  selected: boolean
  expandable?: boolean
  expanded?: boolean
  onToggle?: () => void
  onSelect: () => void
  onOpen?: () => void
}

function TreeItem(props: TreeItemProps) {
  const pad = { paddingLeft: `${8 + props.depth * 14}px` }
  return (
    <div
      className={`tree-item${props.selected ? ' selected' : ''}`}
      style={pad}
      onClick={props.onSelect}
      onDoubleClick={props.onOpen}
    >
      {props.expandable ? (
        <span className="tree-chevron" onClick={(e) => { e.stopPropagation(); props.onToggle?.() }}>
          {props.expanded ? '▾' : '▸'}
        </span>
      ) : (
        <span className="tree-chevron placeholder" />
      )}
      {props.icon && <span className="tree-icon">{props.icon}</span>}
      <span className="tree-label">{props.label}</span>
      {props.kind && <span className="tree-kind">{props.kind}</span>}
    </div>
  )
}

const GLYPHS: Record<string, string> = {
  and: '&',
  or: '≥1',
  xor: '=1',
  not: '1',
  clock: '∿',
}

function CompositeChildren({ def, depth, selectId, onOpen }: {
  def: ComponentDef
  depth: number
  selectId: (id: string) => void
  onOpen: (id: string) => void
}) {
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const design = useEditorStore((s) => s.design)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  return (
    <>
      {def.instances?.map((inst: Instance) => {
        const childDef = design.defs[inst.defId]
        const isComposite = childDef?.kind === 'composite'
        const isExpanded = expanded[inst.id] ?? false
        const icon = childDef?.primitive ? GLYPHS[childDef.primitive] ?? '·' : '▣'
        return (
          <div key={inst.id}>
            <TreeItem
              label={inst.name}
              depth={depth}
              icon={icon}
              kind={childDef?.primitive ? childDef.primitive : 'composite'}
              selected={selectedIds.includes(inst.id)}
              expandable={isComposite}
              expanded={isExpanded}
              onToggle={() => setExpanded((m) => ({ ...m, [inst.id]: !m[inst.id] }))}
              onSelect={() => selectId(inst.id)}
              onOpen={isComposite ? () => onOpen(inst.defId) : undefined}
            />
            {isComposite && isExpanded && (
              <CompositeChildren def={childDef} depth={depth + 1} selectId={selectId} onOpen={onOpen} />
            )}
          </div>
        )
      })}
    </>
  )
}

export function Sidebar({ width }: { width: number }) {
  const design = useEditorStore((s) => s.design)
  const navStack = useEditorStore((s) => s.navStack)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const setSelection = useEditorStore((s) => s.setSelection)
  const navigateTo = useEditorStore((s) => s.navigateTo)

  const rootDef = design.defs[design.root]
  const current = design.defs[currentDefId(useEditorStore.getState())]

  return (
    <aside className="sidebar" style={{ width }}>
      <div className="side-section">
        <div className="side-title">Components</div>
        <div className="tree">
          <TreeItem
            label={rootDef.name}
            depth={0}
            icon="▣"
            kind="root"
            selected={false}
            expandable
            expanded
            onSelect={() => setSelection([])}
            onOpen={() => navigateTo(rootDef.id)}
          />
          <div className="tree">
            <CompositeChildren def={current} depth={1} selectId={(id) => setSelection([id])} onOpen={navigateTo} />
          </div>
        </div>
        {navStack.length > 0 && (
          <div className="side-note">double-click a composite to open it</div>
        )}
      </div>

      <div className="side-section grow">
        <div className="side-title">Properties</div>
        <PropertiesPanel selectedIds={selectedIds} />
      </div>
    </aside>
  )
}

function PropertiesPanel({ selectedIds }: { selectedIds: string[] }) {
  const design = useEditorStore((s) => s.design)
  if (selectedIds.length === 0) {
    return <div className="props-empty">Nothing selected</div>
  }
  if (selectedIds.length > 1) {
    return <div className="props-empty">{selectedIds.length} components selected</div>
  }
  const current = design.defs[currentDefId(useEditorStore.getState())]
  const inst = current.instances?.find((i) => i.id === selectedIds[0])
  if (!inst) {
    return <div className="props-empty">Nothing selected</div>
  }
  const def = design.defs[inst.defId]
  return (
    <div className="props">
      <label className="field">
        <span>Name</span>
        <input defaultValue={inst.name} />
      </label>
      <label className="field">
        <span>Type</span>
        <input defaultValue={def.kind === 'primitive' ? def.primitive : 'composite'} readOnly />
      </label>
      <div className="field-row">
        <label className="field">
          <span>Inputs</span>
          <input defaultValue={def.inputs} readOnly />
        </label>
        <label className="field">
          <span>Outputs</span>
          <input defaultValue={def.outputs} readOnly />
        </label>
      </div>
      {def.primitive === 'clock' && (
        <label className="field">
          <span>Period (ns)</span>
          <input defaultValue={10} />
        </label>
      )}
      <div className="field-row">
        <label className="field">
          <span>X</span>
          <input defaultValue={Math.round(inst.pos.x)} />
        </label>
        <label className="field">
          <span>Y</span>
          <input defaultValue={Math.round(inst.pos.y)} />
        </label>
      </div>
    </div>
  )
}
