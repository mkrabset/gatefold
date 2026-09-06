import type { Connection, PinRef } from './types'

/** Structural equality for connection endpoints. */
export function pinRefEquals(a: PinRef, b: PinRef): boolean {
  return a.instanceId === b.instanceId && a.portId === b.portId
}

/** Produce the next free connection id (`c1`, `c2`, …), skipping any collisions. */
export function nextConnectionId(connections: Connection[]): string {
  const ids = new Set(connections.map((c) => c.id))
  let i = connections.length + 1
  while (ids.has(`c${i}`)) i++
  return `c${i}`
}

/** Canonical string key for a connection endpoint (instance + port). */
export function pinKey(ref: PinRef): string {
  return `${ref.instanceId}:${ref.portId}`
}

/**
 * The connection currently driving the sink `to`, or null. Enforces the
 * single-driver invariant: each input pin / composite output port has at most one
 * incoming connection.
 */
export function findConnectionTo(connections: Connection[], to: PinRef): Connection | null {
  return connections.find((c) => pinRefEquals(c.to, to)) ?? null
}
