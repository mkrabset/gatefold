import type { ComponentDef, Design, Port } from '@logica/model'
import { cloneDesign, copyDefSubgraph, inputPorts, outputPorts, resolvedPinWidth } from '@logica/model'

/**
 * Propagate a composite template's changes to every matching variant in a given
 * scope. A variant "matches" when it was instantiated from the template (same lineage
 * `uuid`) and its terminal interface is unaltered (same port ids/names/order, arity
 * compatible). Inversion is treated as an external alteration and is preserved from
 * the variant rather than copied from the template.
 */

/** All def ids reachable from `startId` by following instances (inclusive). */
export function scopeDefIds(design: Design, startId: string): Set<string> {
  const seen = new Set<string>([startId])
  const stack = [startId]
  while (stack.length > 0) {
    const id = stack.pop()!
    const def = design.defs[id]
    if (!def) continue
    for (const inst of def.instances ?? []) {
      if (!seen.has(inst.defId)) {
        seen.add(inst.defId)
        stack.push(inst.defId)
      }
    }
  }
  return seen
}

/** The determined width of a composite port, or null when undetermined/neutral. */
function portArity(design: Design, def: ComponentDef, port: Port): number | null {
  const t = port.terminal
  if (!t) return null
  return resolvedPinWidth(design, def, { instanceId: t.instanceId, portId: t.pinId })
}

/** Whether `variant`'s terminals are an unaltered copy of `template`'s (ignoring inversion). */
function portsMatch(design: Design, template: ComponentDef, variant: ComponentDef): boolean {
  const side = (t: Port[], v: Port[]): boolean => {
    if (t.length !== v.length) return false
    for (let i = 0; i < t.length; i++) {
      if (t[i].id !== v[i].id || t[i].name !== v[i].name) return false
      const a = portArity(design, template, t[i])
      const b = portArity(design, variant, v[i])
      if (a !== null && b !== null && a !== b) return false
    }
    return true
  }
  return side(inputPorts(template), inputPorts(variant)) && side(outputPorts(template), outputPorts(variant))
}

/** Apply `template` to every matching variant whose id is in `scope`. Returns a new
 *  design (pure) and the number of variants updated. */
export function applyTemplate(design: Design, templateId: string, scope: Set<string>): { design: Design; updated: number } {
  const result = cloneDesign(design)
  const template = result.defs[templateId]
  let updated = 0
  if (!template || template.kind !== 'composite' || template.variant === true) {
    return { design: result, updated: 0 }
  }

  for (const variant of Object.values(result.defs)) {
    if (variant.kind !== 'composite' || variant.variant !== true) continue
    if (variant.uuid !== template.uuid) continue
    if (!scope.has(variant.id)) continue
    if (!portsMatch(result, template, variant)) continue

    const usedIds = new Set(Object.keys(result.defs))
    const { defs: copied, idMap } = copyDefSubgraph(result.defs, [templateId], usedIds)
    const top = copied[idMap.get(templateId)!]
    for (const [copyId, d] of Object.entries(copied)) {
      if (copyId !== top.id) result.defs[copyId] = d
    }

    const oldPorts = variant.ports
    variant.instances = top.instances
    variant.connections = top.connections
    variant.ports = top.ports.map((tp, i) => ({ ...tp, inverted: oldPorts[i]?.inverted }))
    variant.name = template.name
    updated++
  }

  return { design: result, updated }
}
