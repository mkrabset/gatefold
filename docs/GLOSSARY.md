# Glossary

Terminology used across Logica's code, docs, and discussions. Kept terse and
authoritative — update this when a term's meaning changes.

## Core data

- **Design** — the whole document: `{ version, root, defs }`. The unit saved/loaded as JSON.
- **Definition (`ComponentDef`)** — a reusable *type*: a `primitive` or `composite`.
  Has `id`, `name`, `kind`, `ports`, and (composites only) `instances` + `connections`.
- **Instance** — a concrete placement of a definition at a position, with its own unique
  `id` and `name`. References its def via `defId`.
- **Primitive** — a built-in component with hard-coded behavior: AND, OR, XOR, NOT, CLOCK,
  FAN-IN, FAN-OUT (plus the internal INPUT-PORT / OUTPUT-PORT). Not editable as a circuit.
- **Property** — a user-configurable value declared by a primitive (`PropertySpec`, with a
  default + unit/min/max); stored per-instance in `Instance.props`. E.g. a CLOCK's `period`.
- **Composite / custom component** — a user-defined component whose behavior is its
  internal circuit (instances + connections). "Custom component" is our everyday synonym.
- **Template** — a definition in the library (`variant` not set). Placed via drag; edited
  by double-clicking its library card; never mutated by editing an instance.
- **Variant** — an instance-local copy of a definition (`variant: true`), created on
  placement/grouping (see **Copy-on-place**). Hidden from the library.
- **Root** — the top-level composite (`design.root`, usually `main`); the outermost sheet.

## Terminals & wiring

- **Port** — a declared terminal on a *definition* (`id`, `name`, `direction`), ordered
  inputs-first. For composites, `terminal` links it to its internal port-group pin.
- **Terminal / pin** — a connectable endpoint on an *instance*. (We use "port" for the
  declaration and "pin/terminal" for the concrete endpoint; often interchangeable.)
- **PinRef** — `{ instanceId, portId }`: a reference to one specific pin.
- **Connection / wire** — a directed edge from a source pin to a sink pin.
- **Source / driver** — the `from` end of a connection (an output pin, or a composite
  input-port terminal).
- **Sink / load** — the `to` end (an input pin, or a composite output-port terminal).
- **Port group** — the single `input-port` / `output-port` instance inside a composite
  that carries all its ports; its pins are *derived* from the parent's `ports`.
- **Single-driver invariant** — each sink has at most one incoming connection; fan-out
  from a source is unrestricted.

## Buses

- **Bus** — a terminal/wire carrying more than one wire.
- **Width / arity** — the number of wires a terminal carries (`1` = single wire, `n` = bus).
- **Fan-in** — primitive with `n` single-wire inputs → `1` bus output (width `n`).
- **Fan-out** — primitive with `1` bus input (width `n`) → `n` single-wire outputs.
- **Neutral port** — a composite port with no connections; its width is unconstrained and
  *adopts* the width of whatever bus it is connected to.

## Editing operations

- **Copy-on-place** — placing (drag) or grouping deep-copies a template and its whole
  hierarchy into `variant` defs, so instances are independent from birth.
- **Grouping** — turning a selection into a composite (`inferGroup` → naming dialog →
  `applyGroup`); a single selected custom component is *promoted* to a template instead.
- **Navigation (descend/ascend)** — the `navStack` of def ids; double-click a component to
  enter it, Escape / breadcrumb ↑ to exit.
- **Selection** — `selectedIds`; marquee (drag empty space), Shift+click to toggle, drag a
  selected component to move the whole selection.

## Simulation (planned, not yet implemented)

- **Signal** — 3-state logic value: `0`, `1`, `X` (unknown). `Z` (high-impedance) deferred.
