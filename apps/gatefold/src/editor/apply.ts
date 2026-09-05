import type { CompositeDef, Design, Port } from '@gatefold/model'
import { allCompositeIds, cloneComposite, cloneDesign, collectCompositeSubtree, inputPorts, outputPorts, resolvedPinWidth, walkComposites } from '@gatefold/model'

/**
 * Propagate a composite template's changes to every matching live copy in a given
 * scope. A live copy "matches" when it was instantiated from the template (same lineage
 * `uuid`) and its terminal interface is unaltered (same ordered port ids; arity
 * compatible). Port names are ignored during matching and overwritten from the
 * template on apply (so a template rename bulk-updates instances). Inversion is treated
 * as an external alteration and is preserved from the copy rather than copied from
 * the template.
 */

/** All composite ids reachable from `root` by following instances (inclusive). */
export function scopeDefIds(root: CompositeDef): Set<string> {
  return collectCompositeSubtree(root)
}

/** The determined width of a composite port, or null when undetermined/neutral. */
function portArity(def: CompositeDef, port: Port): number | null {
  const t = port.terminal
  if (!t) return null
  return resolvedPinWidth(def, { instanceId: t.instanceId, portId: t.pinId })
}

/** Whether `copy`'s terminals match `template`'s by ordered id (names ignored). */
function portsMatch(template: CompositeDef, copy: CompositeDef): boolean {
  const side = (t: Port[], v: Port[]): boolean => {
    if (t.length !== v.length) return false
    for (let i = 0; i < t.length; i++) {
      if (t[i].id !== v[i].id) return false
      const a = portArity(template, t[i])
      const b = portArity(copy, v[i])
      if (a !== null && b !== null && a !== b) return false
    }
    return true
  }
  return side(inputPorts(template.ports), inputPorts(copy.ports)) && side(outputPorts(template.ports), outputPorts(copy.ports))
}

/** Apply `template` to every matching live copy whose id is in `scope`. Returns a new
 *  design (pure) and the number of copies updated. */
export function applyTemplate(design: Design, templateId: string, scope: Set<string>): { design: Design; updated: number } {
  const result = cloneDesign(design)
  const template = result.library[templateId]
  let updated = 0
  if (!template) {
    return { design: result, updated: 0 }
  }

  const matches: CompositeDef[] = []
  walkComposites(result.root, (live) => {
    if (live.uuid !== template.uuid) return
    if (!scope.has(live.id)) return
    matches.push(live)
  })

  for (const live of matches) {
    if (!portsMatch(template, live)) continue
    // Deep-copy the template (its embedded children come along by ownership) and splice
    // the fresh internals into the matching live copy, keeping its id, ports' inversion,
    // and external wiring.
    const top = cloneComposite(template, allCompositeIds(result))
    const oldPorts = live.ports
    live.instances = top.instances
    live.connections = top.connections
    live.ports = top.ports.map((tp, i) => ({ ...tp, inverted: oldPorts[i]?.inverted }))
    live.name = template.name
    updated++
  }

  return { design: result, updated }
}
