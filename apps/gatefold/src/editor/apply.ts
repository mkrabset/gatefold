import type { ComponentDef, CompositeDef, Design, Port } from '@gatefold/model'
import { cloneDesign, collectClosure, combinedDefs, copyDefSubgraph, inputPorts, outputPorts, resolvedPinWidth } from '@gatefold/model'

/**
 * Propagate a composite template's changes to every matching live copy in a given
 * scope. A live copy "matches" when it was instantiated from the template (same lineage
 * `uuid`) and its terminal interface is unaltered (same ordered port ids; arity
 * compatible). Port names are ignored during matching and overwritten from the
 * template on apply (so a template rename bulk-updates instances). Inversion is treated
 * as an external alteration and is preserved from the copy rather than copied from
 * the template.
 */

/** All content-tree def ids reachable from `startId` by following instances (inclusive). */
export function scopeDefIds(design: Design, startId: string): Set<string> {
  return collectClosure(design.defs, [startId], () => false)
}

/** The determined width of a composite port, or null when undetermined/neutral. */
function portArity(design: Design, def: ComponentDef, port: Port): number | null {
  const t = port.terminal
  if (!t) return null
  return resolvedPinWidth(design, def, { instanceId: t.instanceId, portId: t.pinId })
}

/** Whether `copy`'s terminals match `template`'s by ordered id (names ignored). */
function portsMatch(design: Design, template: ComponentDef, copy: ComponentDef): boolean {
  const side = (t: Port[], v: Port[]): boolean => {
    if (t.length !== v.length) return false
    for (let i = 0; i < t.length; i++) {
      if (t[i].id !== v[i].id) return false
      const a = portArity(design, template, t[i])
      const b = portArity(design, copy, v[i])
      if (a !== null && b !== null && a !== b) return false
    }
    return true
  }
  return side(inputPorts(template), inputPorts(copy)) && side(outputPorts(template), outputPorts(copy))
}

/** Apply `template` to every matching live copy whose id is in `scope`. Returns a new
 *  design (pure) and the number of copies updated. */
export function applyTemplate(design: Design, templateId: string, scope: Set<string>): { design: Design; updated: number } {
  const result = cloneDesign(design)
  const template = result.library[templateId]
  let updated = 0
  if (!template || template.kind !== 'composite') {
    return { design: result, updated: 0 }
  }

  for (const live of Object.values(result.defs)) {
    if (live.kind !== 'composite') continue
    if (live.uuid !== template.uuid) continue
    if (!scope.has(live.id)) continue
    if (!portsMatch(result, template, live)) continue

    // Deep-copy the template's subgraph (its embedded parts) into the content tree as
    // fresh live defs, then splice the top copy's internals into the matching live copy.
    const usedIds = new Set([...Object.keys(result.library), ...Object.keys(result.defs)])
    const { defs: copied, idMap } = copyDefSubgraph(combinedDefs(result), [templateId], usedIds)
    const top = copied[idMap.get(templateId)!] as CompositeDef
    for (const [copyId, d] of Object.entries(copied)) {
      if (copyId !== top.id) result.defs[copyId] = d
    }

    const oldPorts = live.ports
    live.instances = top.instances
    live.connections = top.connections
    live.ports = top.ports.map((tp, i) => ({ ...tp, inverted: oldPorts[i]?.inverted }))
    live.name = template.name
    updated++
  }

  return { design: result, updated }
}
