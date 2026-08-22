# Glossary

Terminology used across Logica's code, docs, and discussions. Kept terse and
authoritative — update this when a term's meaning changes.

## Core data

- **Design** — the whole document: `{ version, root, defs }`. The unit saved/loaded as JSON.
- **Definition (`ComponentDef`)** — a reusable *type*: a `primitive` or `composite`.
  Has `id`, `name`, `kind`, `ports`, and (composites only) `instances` + `connections`.
- **Instance** — a concrete placement of a definition at a position, with its own unique
  `id` and `name`. References its def via `defId`.
- **Primitive** — a built-in component with hard-coded behavior: AND, OR, XOR, NOT, BUFFER,
  CLOCK, FAN-IN, FAN-OUT, BUS-SPLIT, BUS-MERGE, BUS (plus the internal INPUT-PORT / OUTPUT-PORT),
  and the probe primitives 7-SEG, SWITCH-ARRAY, LED-ARRAY. Not editable as a circuit.
- **Buffer** — a primitive passing its single input through to its output unchanged; a NOT
  gate is a buffer whose output terminal is inverted.
- **Clock** — a source primitive (no inputs, one output) that produces a periodic square
  wave; its `period` (ps) is a per-instance property. Drawn with a zoom-scaled square-wave
  glyph (sine phase).
- **7-seg** — a probe primitive (sink) with a single bus input that renders one digit per
  4-bit nibble (width divisible by 4, ≤ 64); its `order` property (`asc`/`desc`) picks which
  end of the bus is the least-significant bit.
- **Switch-array / LED-array** — multi-lane source/sink probes. A `terminalType` property
  picks `wire` (one single-wire terminal per lane, default 1, added/removed via the ports
  editor) or `bus` (one terminal whose width is adopted from the connection, rendering a `?`
  while undetermined). Each lane toggles/reads independently. They supersede the removed
  single-lane SWITCH and LED primitives.
- **Property** — a user-configurable value declared by a primitive (`PropertySpec`, with a
  default + unit/min/max/`select` options); stored per-instance in `Instance.props`. E.g. a
  CLOCK's `period`, a BUS's `lanes`, a 7-SEG's `order`. For arrays, `terminalType` is
  *property-driven*: changing it regenerates the instance's variant-def ports.
- **Composite / custom component** — a user-defined component whose behavior is its
  internal circuit (instances + connections). "Custom component" is our everyday synonym.
- **Template** — a definition in the library (`variant` not set). Placed via drag; edited
  by double-clicking its library card; never mutated by editing an instance.
- **Variant** — an instance-local copy of a definition (`variant: true`), created on
  placement/grouping (see **Copy-on-place**). Hidden from the library.
- **Lineage id (`uuid`)** — a `ComponentDef.uuid` shared by a template and every variant
  copied from it, marking which template a variant originated from. `id` stays the unique key;
  `uuid` is for origin/apply. Preserved by all copies; freshly assigned on grouping, promote,
  import, and load-migration.
- **Root** — the top-level composite (`design.root`, usually `main`); the outermost sheet.

## Terminals & wiring

- **Port** — a declared terminal on a *definition* (`id`, `name`, `direction`), ordered
  inputs-first. For composites, `terminal` links it to its internal port-group pin.
- **Inverted terminal** — a port whose `inverted` flag is set, rendered as a hollow ring
  just outside the pin (a logic negation bubble). Instance-level: templates keep clean
  (non-inverted) ports, and inversion lives on variants (preserved when a template is applied).
- **Terminal / pin** — a connectable endpoint on an *instance*. (We use "port" for the
  declaration and "pin/terminal" for the concrete endpoint; often interchangeable.)
- **Terminal marker** — the vertical stroke drawn along a component's edge for a pin; its
  half-height is `pinRadiusWorld(width) = 3.5·width` (linear). Markers on a side are stacked
  with a constant gap, so a bus does not dictate the spacing of its single-wire neighbours.
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
- **Bus-split** — primitive with `1` bus input (width `n`) → `2` bus outputs (width `n/2`).
- **Bus-merge** — primitive with `2` bus inputs (width `m`) → `1` bus output (width `2m`).
- **Bus (primitive)** — a passthrough (single bus in → single bus out) whose `lanes` property
  fixes the width of both terminals, used to pin a bus to a specific width.
- **Neutral port** — a terminal whose width is undetermined (no constant reaches it); it
  *adopts* the width of whatever bus it is connected to. Rendered as a thin dashed wire.
- **Width solver** — the fixpoint that derives every terminal's width from fan-in/fan-out
  arity constants, connection equalities, composite-terminal mirrors, split/merge relations,
  and property-driven intrinsic widths (the `bus` primitive's `lanes`). A conflict, a
  non-integer result (odd bus into a splitter), or a failed `widthError` constraint (7-seg
  multiple-of-4 / ≤64) is invalid.

## Editing operations

- **Copy-on-place** — placing (drag) or grouping deep-copies a template and its whole
  hierarchy into `variant` defs, so instances are independent from birth.
- **Grouping** — turning a selection into a composite (`inferGroup` → naming dialog →
  `applyGroup`); a single selected custom component is *promoted* to a template instead.
- **Apply template** — propagating a template's edits to every matching variant in the current
  scope (same lineage `uuid` + same ordered port ids). Port names are ignored and overwritten
  from the template. Replaces internals, preserves external wiring and the variant's inversion.
- **Navigation (descend/ascend)** — the `navStack` of def ids; double-click a component to
  enter it, Escape / breadcrumb ↑ to exit.
- **Fit-to-view** — when you enter a component, the canvas auto-zooms/pans so its internals
  fill the view. A **viewport stack** (parallel to `navStack`) remembers the outgoing
  transform, so exiting restores the exact view you left.
- **Selection** — `selectedIds`; marquee (drag empty space), Shift+click to toggle, drag a
  selected component to move the whole selection.

## Simulation

- **Signal** — 3-state logic value: `0`, `1`, `X` (unknown). `Z` (high-impedance) deferred;
  `x` also covers hi-Z/undriven for now.
- **`transfer`** — a primitive's pure combinational function (`Signal[][] → Signal[][]`),
  used by the simulator; sources/sinks return `[]`.
- **Flatten** — expand the hierarchy through `Port.terminal` into leaf primitive instances
  + nets, so the simulator can evaluate the whole design.
- **Net** — a set of pins wired together (union of connections and composite terminals),
  carrying one bit-vector.
- **Event-driven / inertial delay** — the simulator schedules each gate's output change
  `delay` ps after its inputs change; a newer change within the delay window supersedes the
  pending one (inertial). Delay is configurable (`defaultDelay` ps + per-kind overrides).
- **Power-on resolution** — driven nets initialize to `0` (floating stay `x`), then a
  zero-delay Gauss-Seidel pass settles feedback loops to a valid stable state; true
  oscillators freeze at `x`. This resolves an otherwise-`x` gated latch/flip-flop.
- **Step mode** — how the Step button advances: `quiescent` (settle to quiescence) or
  `clock-edge` (advance to the next clock edge).
- **Signal coloring** — wires/markers colored by their simulated value: red = `1`, black = `0`,
  gray = `x`.
