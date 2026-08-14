export type Signal = 0 | 1 | 'x'

export type PortDirection = 'input' | 'output'

export interface Port {
  id: string
  name: string
  direction: PortDirection
}

export type PrimitiveKind = 'and' | 'or' | 'xor' | 'not' | 'clock'

export interface ComponentDef {
  id: string
  name: string
  kind: 'primitive' | 'composite'
  primitive?: PrimitiveKind
  ports: Port[]
  instances?: Instance[]
  connections?: Connection[]
}

export interface Instance {
  id: string
  name: string
  defId: string
  pos: { x: number; y: number }
}

export type PinRef =
  | { kind: 'instance'; instanceId: string; portId: string }
  | { kind: 'port'; portId: string }

export interface Connection {
  id: string
  from: PinRef
  to: PinRef
}

export interface Design {
  version: number
  root: string
  defs: Record<string, ComponentDef>
}

export const inputPortId = (index: number) => `in:${index}`
export const outputPortId = (index: number) => `out:${index}`

export function inputPorts(def: ComponentDef): Port[] {
  return def.ports.filter((p) => p.direction === 'input')
}

export function outputPorts(def: ComponentDef): Port[] {
  return def.ports.filter((p) => p.direction === 'output')
}

export function nextPortId(def: ComponentDef, direction: PortDirection): string {
  const prefix = direction === 'input' ? 'in' : 'out'
  const used = def.ports
    .filter((p) => p.direction === direction)
    .map((p) => {
      const idx = Number(p.id.split(':')[1])
      return Number.isFinite(idx) ? idx : -1
    })
  let i = 0
  while (used.includes(i)) i++
  return `${prefix}:${i}`
}
