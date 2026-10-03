import { useEffect, useRef } from 'react'
import { inputPorts, outputPorts } from '@gatefold/model'
import type { PendingArray } from '../state/editorStore'
import { resolveNav, useEditorStore } from '../state/editorStore'
import { useEscapeToClose } from './useDialog'

/**
 * Modal shown after clicking "Array". Lets the user set the copy count and the
 * inter-copy chain rules (`from` = an output terminal, `to` = an input terminal, wired
 * copy[i].from → copy[i+1].to). "Create" commits via `confirmArray`. Renders nothing
 * while `pendingArray` is null.
 */
export function ArrayDialog() {
  const pendingArray = useEditorStore((s) => s.pendingArray)
  if (!pendingArray) return null
  return <ArrayForm pendingArray={pendingArray} />
}

function ArrayForm({ pendingArray }: { pendingArray: PendingArray }) {
  const design = useEditorStore((s) => s.design)
  const navStack = useEditorStore((s) => s.navStack)
  const setCount = useEditorStore((s) => s.setArrayDialogCount)
  const setChains = useEditorStore((s) => s.setArrayDialogChains)
  const setOrientation = useEditorStore((s) => s.setArrayDialogOrientation)
  const setCommon = useEditorStore((s) => s.setArrayDialogCommon)
  const setNewLayer = useEditorStore((s) => s.setArrayDialogNewLayer)
  const confirmArray = useEditorStore((s) => s.confirmArray)
  const cancelArray = useEditorStore((s) => s.cancelArray)
  const countRef = useRef<HTMLInputElement>(null)
  useEscapeToClose(cancelArray)

  const def = resolveNav(design, navStack)
  const inst = def && def.kind === 'composite' ? def.instances.find((i) => i.id === pendingArray.instanceId) : undefined
  const template = inst?.def
  const outputs = template && template.kind === 'composite' ? outputPorts(template.ports) : []
  const inputs = template && template.kind === 'composite' ? inputPorts(template.ports) : []
  const isArray = !!template && template.kind === 'composite' && !!template.arrayConfig

  useEffect(() => {
    const el = countRef.current
    if (!el) return
    const t = setTimeout(() => {
      el.focus()
      el.select()
    }, 0)
    return () => clearTimeout(t)
  }, [])

  const setChain = (index: number, from: string, to: string) => {
    setChains(pendingArray.chains.map((c, i) => (i === index ? { from, to } : c)))
  }
  const addChain = () => setChains([...pendingArray.chains, { from: outputs[0]?.id ?? '', to: inputs[0]?.id ?? '' }])
  const removeChain = (index: number) => setChains(pendingArray.chains.filter((_, i) => i !== index))

  const chainedInputIds = new Set(pendingArray.chains.map((c) => c.to))
  const toggleCommon = (id: string) => {
    if (pendingArray.common.includes(id)) setCommon(pendingArray.common.filter((c) => c !== id))
    else setCommon([...pendingArray.common, id])
  }

  return (
    <div
      className="dialog-overlay"
      onClick={cancelArray}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) e.preventDefault()
      }}
    >
      <form
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          confirmArray()
        }}
      >
        <div className="dialog-title">Array</div>
        {isArray && (
          <label className="dialog-input-mode" style={{ marginBottom: 8 }} title="Wrap this array in a new array layer instead of editing it in place">
            <input type="checkbox" checked={pendingArray.newLayer} onChange={(e) => setNewLayer(e.target.checked)} />
            New layer
          </label>
        )}
        <div className="dialog-section">
          <div className="dialog-section-title">Count</div>
          <input
            ref={countRef}
            className="dialog-input"
            type="number"
            min={1}
            step={1}
            value={pendingArray.count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
        </div>
        <div className="dialog-section">
          <div className="dialog-section-title">Orientation</div>
          <select
            className="dialog-select"
            value={pendingArray.orientation}
            onChange={(e) => setOrientation(e.target.value === 'vertical' ? 'vertical' : 'horizontal')}
          >
            <option value="horizontal">Horizontal (left to right)</option>
            <option value="vertical">Vertical (top to bottom)</option>
          </select>
        </div>
        <div className="dialog-section">
          <div className="dialog-section-title">Inputs</div>
          {inputs.map((p) => {
            const chained = chainedInputIds.has(p.id)
            const common = pendingArray.common.includes(p.id)
            return (
              <label className="dialog-input-row" key={p.id}>
                <span className="dialog-input-name">{p.name || p.id}</span>
                {chained ? (
                  <span className="dialog-input-chained">chained</span>
                ) : (
                  <label className="dialog-input-mode" title="Deliver one shared wire to every copy, instead of a per-copy bus">
                    <input type="checkbox" checked={common} onChange={() => toggleCommon(p.id)} />
                    Common (shared)
                  </label>
                )}
              </label>
            )
          })}
          {inputs.length === 0 && <div className="dialog-empty">no inputs</div>}
        </div>
        <div className="dialog-section">
          <div className="dialog-section-title">Chains (copy[i] → copy[i+1])</div>
          {pendingArray.chains.map((chain, i) => (
            <div className="dialog-chain-row" key={i}>
              <select
                className="dialog-select"
                value={chain.from}
                onChange={(e) => setChain(i, e.target.value, chain.to)}
                title="Source output terminal"
              >
                {outputs.map((p) => (
                  <option key={p.id} value={p.id}>{p.name || p.id}</option>
                ))}
              </select>
              <span className="dialog-chain-arrow">→</span>
              <select
                className="dialog-select"
                value={chain.to}
                onChange={(e) => setChain(i, chain.from, e.target.value)}
                title="Destination input terminal"
              >
                {inputs.map((p) => (
                  <option key={p.id} value={p.id}>{p.name || p.id}</option>
                ))}
              </select>
              <button type="button" className="dialog-btn" onClick={() => removeChain(i)} title="Remove chain">
                ×
              </button>
            </div>
          ))}
          {pendingArray.chains.length === 0 && <div className="dialog-empty">no chains</div>}
          <button type="button" className="dialog-btn" onClick={addChain} disabled={outputs.length === 0 || inputs.length === 0}>
            Add chain
          </button>
        </div>
        <div className="dialog-actions">
          <button type="button" className="dialog-btn" onClick={cancelArray}>Cancel</button>
          <button type="submit" className="dialog-btn primary">Create</button>
        </div>
      </form>
    </div>
  )
}
