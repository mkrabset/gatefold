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
  inputs: number
  outputs: number
  instances?: Instance[]
  connections?: Connection[]
}

export interface Instance {
  id: string
  name: string
  defId: string
  pos: { x: number; y: number }
}

export interface Connection {
  id: string
  from: { instanceId: string; portId: string }
  to: { instanceId: string; portId: string }
}

export interface Design {
  version: number
  root: string
  defs: Record<string, ComponentDef>
}

export const inputPortId = (index: number) => `in:${index}`
export const outputPortId = (index: number) => `out:${index}`
