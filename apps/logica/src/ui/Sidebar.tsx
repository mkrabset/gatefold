import { useState } from 'react'
import { currentDefId, useEditorStore } from '../state/editorStore'
import type { ComponentDef, Instance, Port } from '@logica/model'
import type { PropertySpec } from '@logica/model'
import { allowRenameTerminals, inputPorts, isArityFixed, isNavigableDef, outputPorts, primitiveOf } from '@logica/model'
import { CommitInput } from './CommitInput'
import { SortablePortList } from './SortablePortList'

/**
 * Left sidebar: a component tree for the current definition (double-click a
 * composite to descend into it) plus a properties panel for the current selection
 * and a ports editor for the currently-viewed composite.
 */

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
        const icon = childDef?.primitive ? primitiveOf(childDef.primitive).glyph : '▣'
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
              onOpen={childDef && isNavigableDef(childDef) ? () => onOpen(inst.defId) : undefined}
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
        <div className="side-title">Ports</div>
        <PortsEditor />
      </div>
    </aside>
  )
}

function PropertiesPanel({ selectedIds }: { selectedIds: string[] }) {
  const design = useEditorStore((s) => s.design)
  if (selectedIds.length === 0) {
    // Editing a composite template with nothing selected: allow renaming the template.
    const current = design.defs[currentDefId(useEditorStore.getState())]
    const isTemplate = current && current.kind === 'composite' && current.variant !== true && current.id !== design.root
    if (isTemplate) {
      return (
        <div className="props">
          <label className="field">
            <span>Name</span>
            <DefNameField key={current.id} defId={current.id} initial={current.name} />
          </label>
        </div>
      )
    }
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
  if (!def) {
    return <div className="props-empty">Nothing selected</div>
  }
  return (
    <div className="props">
      <label className="field">
        <span>Name</span>
        <NameField key={inst.id} id={inst.id} initial={inst.name} />
      </label>
      <label className="field">
        <span>Type</span>
        <input defaultValue={def.kind === 'primitive' ? def.primitive : 'composite'} readOnly />
      </label>
      <div className="field-row">
        <label className="field">
          <span>Inputs</span>
          <input defaultValue={inputPorts(def).length} readOnly />
        </label>
        <label className="field">
          <span>Outputs</span>
          <input defaultValue={outputPorts(def).length} readOnly />
        </label>
      </div>
      {def.kind === 'primitive' &&
        def.primitive &&
        primitiveOf(def.primitive)
          .properties()
          .map((spec) => (
            <label className="field" key={spec.name}>
              <span>{spec.unit ? `${spec.label} (${spec.unit})` : spec.label}</span>
              <PropertyField
                key={`${inst.id}:${spec.name}`}
                instanceId={inst.id}
                spec={spec}
                value={inst.props?.[spec.name] ?? spec.default}
              />
            </label>
          ))}
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

/** A name input that trims and commits on Enter/blur (ignoring blank values). */
function CommitName({ initial, onCommit }: { initial: string; onCommit: (name: string) => void }) {
  return (
    <CommitInput
      defaultValue={initial}
      onCommit={(value) => {
        const v = value.trim()
        if (v) onCommit(v)
      }}
    />
  )
}

/** Instance name input that commits on Enter or blur. */
function NameField({ id, initial }: { id: string; initial: string }) {
  const renameInstance = useEditorStore((s) => s.renameInstance)
  return <CommitName initial={initial} onCommit={(name) => renameInstance(id, name)} />
}

/** Composite-template name input that commits on Enter or blur. */
function DefNameField({ defId, initial }: { defId: string; initial: string }) {
  const renameDef = useEditorStore((s) => s.renameDef)
  return <CommitName initial={initial} onCommit={(name) => renameDef(defId, name)} />
}

/** A custom-property editor that commits its value on Enter/blur (or change for a checkbox). */
function PropertyField({ instanceId, spec, value }: { instanceId: string; spec: PropertySpec; value: unknown }) {
  const setInstanceProp = useEditorStore((s) => s.setInstanceProp)

  if (spec.type === 'boolean') {
    return (
      <input
        type="checkbox"
        defaultChecked={value === true}
        onChange={(e) => setInstanceProp(instanceId, spec.name, e.target.checked)}
      />
    )
  }
  if (spec.type === 'select') {
    return (
      <select value={String(value)} onChange={(e) => setInstanceProp(instanceId, spec.name, e.target.value)}>
        {spec.options?.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    )
  }
  if (spec.type === 'number') {
    return (
      <CommitInput
        type="number"
        defaultValue={String(value)}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        onCommit={(raw) => {
          const n = Number(raw)
          if (Number.isNaN(n)) return
          let v = n
          if (spec.min !== undefined) v = Math.max(spec.min, v)
          if (spec.max !== undefined) v = Math.min(spec.max, v)
          setInstanceProp(instanceId, spec.name, v)
        }}
      />
    )
  }
  return <CommitInput defaultValue={String(value ?? '')} onCommit={(raw) => setInstanceProp(instanceId, spec.name, raw)} />
}

function PortsEditor() {
  const design = useEditorStore((s) => s.design)
  const renamePort = useEditorStore((s) => s.renamePort)
  const setPortInverted = useEditorStore((s) => s.setPortInverted)
  const addPort = useEditorStore((s) => s.addPort)
  const removePort = useEditorStore((s) => s.removePort)
  const setPortOrder = useEditorStore((s) => s.setPortOrder)
  const current = design.defs[currentDefId(useEditorStore.getState())]
  const renameAllowed = allowRenameTerminals(current)
  // Templates keep clean (non-inverted) terminals; inversion is instance-level.
  const invertAllowed = !(current.kind === 'composite' && current.variant !== true && current.id !== design.root)

  // A port is connected if any wire touches its pin on the port group.
  const isConnected = (port: Port): boolean => {
    const instId = port.terminal?.instanceId
    if (!instId) return false
    return (current.connections ?? []).some(
      (c) =>
        (c.from.instanceId === instId && c.from.portId === port.id) ||
        (c.to.instanceId === instId && c.to.portId === port.id),
    )
  }

  const renderGroup = (title: string, ports: ReturnType<typeof inputPorts>, direction: 'input' | 'output') => {
    const fixed = isArityFixed(current, direction)
    return (
      <div className="ports-group">
        <div className="ports-group-header">
          <span>{title}</span>
          <button
            className="mini-btn"
            title={fixed ? `The number of ${direction}s is fixed` : `Add ${direction}`}
            disabled={fixed}
            onClick={() => addPort(direction)}
          >
            +
          </button>
        </div>
        <SortablePortList
          key={current.id}
          direction={direction}
          ports={ports}
          fixed={fixed}
          renameAllowed={renameAllowed}
          invertAllowed={invertAllowed}
          isConnected={isConnected}
          onRename={renamePort}
          onToggleInverted={setPortInverted}
          onRemove={removePort}
          onReorder={setPortOrder}
        />
      </div>
    )
  }

  return (
    <div className="props">
      {renderGroup('Inputs', inputPorts(current), 'input')}
      {renderGroup('Outputs', outputPorts(current), 'output')}
    </div>
  )
}
