import { useEffect, useRef, useState } from 'react'
import { currentWidthRoot, currentTestbenchComposite, resolveNav, useEditorStore } from '../state/editorStore'
import { useSimStore } from '../state/simStore'
import { useUiStore } from '../state/uiStore'
import { useTestStore } from '../state/testStore'
import type { ChildDef, CompositeDef, Instance, PropertyValue } from '@gatefold/model'
import type { PropertySpec } from '@gatefold/model'
import { allowInversion, allowRenameTerminals, childPrimitive, childPorts, inputPorts, isArityFixed, isNavigableDef, isPortGroupDef, isTemplateDef, outputPorts, parseSwitchValue, primitiveOf, romAddressWidthOf, romDataWidthOf, valueFormatOf } from '@gatefold/model'
import { PRIMITIVE_ICONS } from '../icons'
import { CommitInput } from './CommitInput'
import { SortablePortList } from './SortablePortList'
import { arrayLaneCount } from '../editor/geometry'

/**
 * Left sidebar: a component tree for the current definition (double-click a
 * composite to descend into it) plus a properties panel for the current selection
 * and a ports editor for the currently-viewed composite.
 */

interface TreeItemProps {
  label: string
  depth: number
  icon?: string
  iconSrc?: string
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
      {props.iconSrc ? (
        <img className="tree-icon-img" src={props.iconSrc} alt="" draggable={false} />
      ) : props.icon ? (
        <span className="tree-icon">{props.icon}</span>
      ) : null}
      <span className="tree-label">{props.label}</span>
      {props.kind && <span className="tree-kind">{props.kind}</span>}
    </div>
  )
}

function CompositeChildren({ def, depth, selectId, onOpen }: {
  def: ChildDef
  depth: number
  selectId: (id: string) => void
  onOpen: (id: string) => void
}) {
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const instances = def.kind === 'composite' ? def.instances : undefined

  return (
    <>
      {instances?.map((inst: Instance) => {
        const isComposite = inst.def.kind === 'composite'
        const isExpanded = expanded[inst.id] ?? false
        const primitiveKind = childPrimitive(inst.def) ?? undefined
        const iconSrc = primitiveKind ? PRIMITIVE_ICONS[primitiveKind] : undefined
        const icon = iconSrc ? undefined : primitiveKind ? primitiveOf(primitiveKind).glyph : '▣'
        return (
          <div key={inst.id}>
            <TreeItem
              label={inst.name}
              depth={depth}
              icon={icon}
              iconSrc={iconSrc}
              kind={primitiveKind ?? 'composite'}
              selected={selectedIds.includes(inst.id)}
              expandable={isComposite}
              expanded={isExpanded}
              onToggle={() => setExpanded((m) => ({ ...m, [inst.id]: !m[inst.id] }))}
              onSelect={() => selectId(inst.id)}
              onOpen={isNavigableDef(inst.def) ? () => onOpen(inst.id) : undefined}
            />
            {isComposite && isExpanded && (
              <CompositeChildren def={inst.def} depth={depth + 1} selectId={selectId} onOpen={onOpen} />
            )}
          </div>
        )
      })}
    </>
  )
}

export function Sidebar({ width }: { width: number }) {
  const [showTree, setShowTree] = useState(false)
  const design = useEditorStore((s) => s.design)
  const navStack = useEditorStore((s) => s.navStack)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const setSelection = useEditorStore((s) => s.setSelection)
  const navigateTo = useEditorStore((s) => s.navigateTo)
  const simulating = useSimStore((s) => s.mode) === 'simulate'
  const testing = useUiStore((s) => s.middleTab) === 'testing'

  // In simulate mode, navigation is done on the canvas (which keeps the sim path in
  // sync); entering defs from the tree is disabled.
  const openDef = (instanceId: string) => {
    if (!simulating) navigateTo({ kind: 'instance', id: instanceId })
  }

  const rootDef = design.root
  const current = resolveNav(design, navStack) ?? design.root

  // The "Testing" tab edits the test-bench sheet instead of the design: its own
  // properties panel replaces the tree/ports/properties editors.
  if (testing) {
    return (
      <aside className="sidebar" style={{ width }}>
        <div className="side-section grow">
          <div className="side-title">Properties</div>
          <TestbenchProperties />
        </div>
      </aside>
    )
  }

  return (
    <aside className="sidebar" style={{ width }}>
      <div className="side-section">
        <div className="side-title side-title-row">
          <span>Components</span>
          <button
            className="side-toggle"
            title={showTree ? 'Hide component tree' : 'Show component tree'}
            onClick={() => setShowTree((v) => !v)}
          >
            {showTree ? '−' : '+'}
          </button>
        </div>
        {showTree && (
          <>
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
                onOpen={() => openDef(rootDef.id)}
              />
              <div className="tree">
                <CompositeChildren def={current} depth={1} selectId={(id) => setSelection([id])} onOpen={openDef} />
              </div>
            </div>
            {navStack.length > 0 && (
              <div className="side-note">double-click a composite to open it</div>
            )}
          </>
        )}
      </div>

      <div className="side-section grow">
        <div className="side-title">Ports</div>
        <PortsEditor />
        <div className="side-divider" />
        <div className="side-title">Properties</div>
        <PropertiesPanel selectedIds={selectedIds} />
      </div>
    </aside>
  )
}

function PropertiesPanel({ selectedIds }: { selectedIds: string[] }) {
  const design = useEditorStore((s) => s.design)
  const navStack = useEditorStore((s) => s.navStack)
  const current = resolveNav(design, navStack) ?? design.root
  if (selectedIds.length === 0) {
    // Editing a composite template with nothing selected: allow renaming the template.
    const isTemplate = current.kind === 'composite' && isTemplateDef(design, current)
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
  if (current.kind !== 'composite') return <div className="props-empty">Nothing selected</div>
  const inst = current.instances.find((i) => i.id === selectedIds[0])
  if (!inst) {
    return <div className="props-empty">Nothing selected</div>
  }
  const def = inst.def
  const widthRoot = currentWidthRoot(useEditorStore.getState())
  const setInstanceProp = useEditorStore.getState().setInstanceProp
  return (
    <div className="props">
      <label className="field">
        <span>Name</span>
        <NameField key={inst.id} id={inst.id} initial={inst.name} />
      </label>
      <label className="field">
        <span>Type</span>
        <input value={childPrimitive(def) ?? 'composite'} readOnly />
      </label>
      {def.kind === 'composite' && def.arrayConfig && (
        <>
          <label className="field" title="Number of copies in this array">
            <span>Count</span>
            <CommitInput
              type="number"
              min={1}
              step={1}
              defaultValue={def.arrayConfig.count}
              onCommit={(raw) => {
                const n = Number(raw)
                if (Number.isInteger(n) && n >= 1) useEditorStore.getState().setArrayCount(inst.id, n)
              }}
            />
          </label>
          <label className="field" title="Layout direction of the array's copies">
            <span>Orientation</span>
            <select
              className="dialog-select"
              value={def.arrayConfig.orientation}
              onChange={(e) => useEditorStore.getState().setArrayOrientation(inst.id, e.target.value === 'vertical' ? 'vertical' : 'horizontal')}
            >
              <option value="horizontal">Horizontal</option>
              <option value="vertical">Vertical</option>
            </select>
          </label>
        </>
      )}
      {childPrimitive(def) &&
        primitiveOf(childPrimitive(def)!)
          .properties()
          .map((spec) => (
            <label className="field" key={spec.name} title={spec.tooltip}>
              <span>{spec.type === 'number' && spec.unit ? `${spec.label} (${spec.unit})` : spec.label}</span>
              <PropertyField
                key={`${inst.id}:${spec.name}`}
                parentDef={current}
                instance={inst}
                spec={spec}
                value={inst.props?.[spec.name] ?? spec.default}
                setProp={(name, value) => setInstanceProp(inst.id, name, value)}
                widthRoot={widthRoot}
              />
            </label>
          ))}
      {!isPortGroupDef(def) && <PortsGroups instanceId={inst.id} />}
      {childPrimitive(def) === 'rom' && <RomContentsField instanceId={inst.id} instance={inst} />}
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
function PropertyField({
  parentDef,
  instance,
  spec,
  value,
  setProp,
  widthRoot,
}: {
  parentDef: CompositeDef
  instance: Instance
  spec: PropertySpec
  value: PropertyValue
  setProp: (name: string, value: PropertyValue) => void
  widthRoot: CompositeDef
}) {
  if (spec.name === 'initialValue' && childPrimitive(instance.def) === 'switch-array') {
    return <SwitchInitialValueField parentDef={parentDef} instance={instance} value={value} setProp={setProp} widthRoot={widthRoot} />
  }

  if (spec.type === 'boolean') {
    return (
      <input
        type="checkbox"
        defaultChecked={value === true}
        onChange={(e) => setProp(spec.name, e.target.checked)}
      />
    )
  }
  if (spec.type === 'select') {
    return (
      <select value={String(value)} onChange={(e) => setProp(spec.name, e.target.value)}>
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
          setProp(spec.name, v)
        }}
      />
    )
  }
  return <CommitInput defaultValue={String(value ?? '')} onCommit={(raw) => setProp(spec.name, raw)} />
}

/**
 * The switch-array `initialValue` field. Unlike a plain string input it validates the
 * typed text against the switch's resolved width (in its `valueFormat`), rejecting
 * invalid/out-of-range values with a notice and reverting to the last valid text. When
 * the width is undetermined (an unwired bus) the text is accepted verbatim.
 */
function SwitchInitialValueField({
  parentDef,
  instance,
  value,
  setProp,
  widthRoot,
}: {
  parentDef: CompositeDef
  instance: Instance
  value: PropertyValue
  setProp: (name: string, value: PropertyValue) => void
  widthRoot: CompositeDef
}) {
  const setNotice = useEditorStore((s) => s.setNotice)
  const [text, setText] = useState(() => (typeof value === 'string' ? value : ''))
  const lastValid = useRef(typeof value === 'string' ? value : '')
  const textRef = useRef(text)
  textRef.current = text

  const commit = (raw: string) => {
    const t = raw.trim()
    const width = arrayLaneCount(widthRoot, parentDef, instance, instance.def)
    if (width !== null && !parseSwitchValue(t, valueFormatOf(instance.props), width)) {
      setNotice(`Not a valid ${width}-bit value`)
      setText(lastValid.current)
      return
    }
    lastValid.current = t
    setProp('initialValue', t)
  }

  const commitRef = useRef(commit)
  commitRef.current = commit

  // Flush a pending edit on unmount (e.g. a canvas click clears the selection before the
  // field blurs), so a typed value is never silently lost.
  useEffect(() => {
    return () => {
      if (textRef.current !== lastValid.current) commitRef.current(textRef.current)
    }
  }, [])

  return (
    <input
      type="text"
      value={text}
      spellCheck={false}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit(e.currentTarget.value)
          e.currentTarget.blur()
        }
      }}
      onBlur={(e) => commit(e.currentTarget.value)}
    />
  )
}

/**
 * The ROM memory-contents entry: shows the memory's shape and opens the edit dialog.
 */
function RomContentsField({ instanceId, instance }: { instanceId: string; instance: Instance }) {
  const openRomDialog = useEditorStore((s) => s.openRomDialog)
  const words = 1 << romAddressWidthOf(instance.props)
  return (
    <label className="field">
      <span>Memory</span>
      <button type="button" className="field-button" onClick={() => openRomDialog(instanceId)} title="Edit the ROM's memory contents">
        Edit contents…
      </button>
      <span className="side-note">
        {words} × {romDataWidthOf(instance.props)} bits
      </span>
    </label>
  )
}

function PortsGroups({ instanceId }: { instanceId?: string }) {
  const design = useEditorStore((s) => s.design)
  const navStack = useEditorStore((s) => s.navStack)
  const renamePort = useEditorStore((s) => s.renamePort)
  const setPortInverted = useEditorStore((s) => s.setPortInverted)
  const addPort = useEditorStore((s) => s.addPort)
  const removePort = useEditorStore((s) => s.removePort)
  const setPortOrder = useEditorStore((s) => s.setPortOrder)
  const scope = resolveNav(design, navStack)
  const current = instanceId !== undefined
    ? scope && scope.kind === 'composite' ? scope.instances.find((i) => i.id === instanceId)?.def : undefined
    : scope
  if (!current) return null
  const renameAllowed = allowRenameTerminals(current)
  // Templates keep clean (non-inverted) terminals; inversion is instance-level. The
  // scope's own terminals (the input/output port groups, edited without an instanceId)
  // are never invertable — only a selected instance's terminals (instanceId set) get
  // checkboxes, and a primitive that forbids inversion (e.g. the NODE join-point)
  // never does either.
  const invertAllowed = instanceId !== undefined && !(current.kind === 'composite' && isTemplateDef(design, current)) && allowInversion(current)
  const ports = childPorts(current)

  const renderGroup = (title: string, groupPorts: ReturnType<typeof inputPorts>, direction: 'input' | 'output') => {
    const fixed = isArityFixed(current, direction)
    return (
      <div className="ports-group">
        <div className="ports-group-header">
          <span>{title}</span>
          <button
            className="mini-btn"
            title={fixed ? `The number of ${direction}s is fixed` : `Add ${direction}`}
            disabled={fixed}
            onClick={() => addPort(direction, instanceId)}
          >
            +
          </button>
        </div>
        <SortablePortList
          key={current.kind === 'composite' ? current.id : 'primitive'}
          direction={direction}
          ports={groupPorts}
          fixed={fixed}
          renameAllowed={renameAllowed}
          invertAllowed={invertAllowed}
          onRename={(portId, name) => renamePort(portId, name, instanceId)}
          onToggleInverted={(portId, inverted) => setPortInverted(portId, inverted, instanceId)}
          onRemove={(portId) => removePort(portId, instanceId)}
          onReorder={(direction, ids) => setPortOrder(direction, ids, instanceId)}
        />
      </div>
    )
  }

  return (
    <>
      {renderGroup('Inputs', inputPorts(ports), 'input')}
      {renderGroup('Outputs', outputPorts(ports), 'output')}
    </>
  )
}

function PortsEditor() {
  return (
    <div className="props">
      <PortsGroups />
    </div>
  )
}

/**
 * The "Testing" tab's properties panel: edits the selected external (test-bench)
 * component's custom properties, reusing the same `PropertyField` editor but resolving
 * widths against the synthesized test-bench composite.
 */
function TestbenchProperties() {
  const design = useEditorStore((s) => s.design)
  const selectedIds = useTestStore((s) => s.selectedIds)
  const setTestInstanceProp = useEditorStore((s) => s.setTestInstanceProp)
  if (selectedIds.length === 0) return <div className="props-empty">Nothing selected</div>
  if (selectedIds.length > 1) return <div className="props-empty">{selectedIds.length} components selected</div>
  const inst = design.testbench?.instances.find((i) => i.id === selectedIds[0])
  if (!inst) return <div className="props-empty">Nothing selected</div>
  const kind = childPrimitive(inst.def)
  const widthRoot = currentTestbenchComposite(design)
  return (
    <div className="props">
      <label className="field">
        <span>Type</span>
        <input value={kind ?? 'composite'} readOnly />
      </label>
      {kind &&
        primitiveOf(kind)
          .properties()
          .map((spec) => (
            <label className="field" key={spec.name} title={spec.tooltip}>
              <span>{spec.type === 'number' && spec.unit ? `${spec.label} (${spec.unit})` : spec.label}</span>
              <PropertyField
                key={`${inst.id}:${spec.name}`}
                parentDef={widthRoot}
                instance={inst}
                spec={spec}
                value={inst.props?.[spec.name] ?? spec.default}
                setProp={(name, value) => setTestInstanceProp(inst.id, name, value)}
                widthRoot={widthRoot}
              />
            </label>
          ))}
    </div>
  )
}
