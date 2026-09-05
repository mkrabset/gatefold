# Glossary

Terminology used across Gatefold's code, docs, and discussions. Kept terse and
authoritative — update this when a term's meaning changes.

## Core data

- **Design** — the whole document: `{ version, root, library }`. The unit saved/loaded as JSON.
  The model is **nested**: a composite owns its children as inline objects.
- **Definition** — a reusable *type*. Two kinds: a **primitive** (built-in behavior) or a
  **composite** (`CompositeDef`: `id`, `name`, `ports`, `instances`, `connections`, plus
  `uuid`/`category`).
- **Child def (`ChildDef`)** — what an instance actually holds, inline. A discriminated
  union: `builtin` (a shared primitive referenced by kind — the port groups and the
  join-point), `fork` (an owned primitive with its own `ports`, carrying per-instance
  inversion/arity), or a nested `CompositeDef`.
- **Instance** — a concrete placement of a definition at a position, with a unique `id`, a
  display `name` (not enforced unique; logic keys off `id` only), and an inline `def:
  ChildDef` (owned by the parent composite).
- **Primitive** — a built-in component with hard-coded behavior: AND, OR, XOR, NOT, BUFFER,
  CLOCK, FAN-IN, FAN-OUT, BUS-SPLIT, BUS-MERGE, BUS (plus the internal INPUT-PORT / OUTPUT-PORT),
  and the probe primitives 7-SEG, SWITCHES, LEDS. Not editable as a circuit.
- **Fork** — an owned primitive child def with its own `ports`. Every *placed* primitive is
  a fork from birth (copy-on-place), because per-instance terminal `inverted` and array
  `terminalType`/wire-count live on the fork's ports. A shared `builtin` cannot carry that.
- **Builtin** — a shared, immutable primitive reference (`{ kind: 'builtin', primitive }`)
  whose ports are derived from the registry. Used only for the port groups
  (`input-port`/`output-port`) and the join-point.
- **Node (join-point)** — a single-wire passthrough drawn as a filled dot whose one input
  terminal and one output terminal coincide at the body center (`coincidentTerminals`). Multiple
  wires exit by fan-out from its single output. Wires radiating from the dot collapse their
  nearest bezier control point onto it; the dot is wire-colored (signal-colored in simulation,
  red on hover).
- **Buffer** — a primitive passing its single input through to its output unchanged; a NOT
  gate is a buffer whose output terminal is inverted.
- **Clock** — a source primitive (no inputs, one output) that produces a periodic square
  wave; its `period` (ps) is a per-instance property. Drawn with a zoom-scaled square-wave
  glyph (sine phase).
- **DFF** — a D flip-flop primitive (`D`, `CLK`, `RST` → `Q`, `!Q`). A *stateful* primitive the
  simulator evaluates on clock edges rather than via `transfer`: on the configured `edge`
  (`posedge`/`negedge`) `Q` samples `D` (clk-to-q delay), and an asserted `RST` (`resetActiveHigh`
  selects polarity) forces `Q` asynchronously to its `initialValue`. `!Q` is the complement of
  `Q`, inverted internally (its output carries `~Q` without an inversion bubble). This is the
  primitive the future Verilog exporter maps 1:1 to `always @(posedge clk) q <= d` (with a reset
  branch), so sequential circuits export as real FPGA registers rather than feedback gate
  structures.
- **7-seg** — a probe primitive (sink) with a single bus input (width divisible by 4, ≤ 64).
  Its `mode` property (`HEX` / `DEC` / `SIGNED DEC`) picks the decoding: hexadecimal, unsigned
  decimal, or two's-complement decimal (with a leading `−` sign slot); `order` (`asc`/`desc`)
  picks which end of the bus is the least-significant bit.
- **Switches / LEDs** — multi-lane source/sink probes. A `terminalType` property picks
  `wire` (one single-wire terminal per lane, added/removed via the ports editor) or `bus`
  (one terminal whose width is adopted from the connection, rendering a `?` while
  undetermined); `bus` is the default. Each lane toggles/reads independently; the switch-array's
  `initialValue` (boolean) sets every lane's starting state when simulation begins. A switch's
  `valueFormat` (`HEX`/`DEC`/`SIGNED DEC`, default HEX) is the initial radix of its **set-value
  dialog**, and its `order` (`asc`/`desc`) picks which end of the bus is the least-significant
  bit when a typed value is mapped onto the lanes.
- **Value format** — the radix (`HEX`/`DEC`/`SIGNED DEC`) used to enter/display a multi-bit
  value. Shared by the 7-seg display's `mode` and the switch-array's `valueFormat`; the single
  `ValueFormat` type lives in the model's `value.ts`.
- **Set-value dialog** — a simulate-mode dialog (opened from a switch-array's `#` badge) that
  types a whole value into a switch instead of clicking lanes. Its radix dropdown is local to
  the dialog (does not alter the instance's `valueFormat`); `Enter` commits, `Escape` cancels.
- **Property** — a user-configurable value declared by a primitive (`PropertySpec`, with a
  default + unit/min/max/`select` options); stored per-instance in `Instance.props`. E.g. a
  CLOCK's `period`, a BUS's `lanes`, a 7-SEG's `order`. For arrays, `terminalType` is
  *property-driven*: changing it regenerates the instance's fork-def ports.
- **Composite / custom component** — a user-defined component whose behavior is its
  internal circuit (instances + connections). "Custom component" is our everyday synonym.
- **Template** — a component definition that lives in the **library** (`design.library`) and is
  shown in the "My components" panel. Placed via drag; edited by double-clicking its library
  card; never mutated by editing an instance. An **origin template** is one that is not itself an
  embedded part of another template.
- **Category** — an optional user-defined grouping (`CompositeDef.category`) that organizes
  the library's custom components; `undefined`/blank reads as **Uncategorized**. The library
  panel shows one category at a time via a dropdown, and a component is moved by selecting its
  card and choosing a category (or typing a new one). Serialized with the design and carried
  through library export/import.
- **Copy** — an instantiation of a template (or a fork of a primitive) that is a full, independent
  definition. A **live copy** lives in the content tree (a nested `CompositeDef` under `root`);
  an **embedded copy** lives inline inside a library template as "part of" it. Whether a def
  is a template or a copy is determined purely by *location*.
- **Content tree** — the live objects: the root composite plus every live copy, all nested
  under `design.root` (which is a `CompositeDef`).
- **Library** — the set of templates (`design.library`): origin templates, keyed by id. A
  template owns its embedded copies inline (nested), so it is self-contained.
- **Lineage id (`uuid`)** — a `CompositeDef.uuid`. On an origin template it is the template's
  identity; on a copy (embedded or live) it is a **soft link** back to the origin template that
  instantiated it. `id` stays the unique key; `uuid` is for origin/apply. Deleting a template
  clears the `uuid` on its copies rather than leaving a dangling pointer.
- **Root** — the top-level composite (`design.root`, usually `main`); the outermost sheet, in the
  content tree.

## Terminals & wiring

- **Port** — a declared terminal on a *definition* (`id`, `name`, `direction`), ordered
  inputs-first. For composites, `terminal` links it to its internal port-group pin.
- **Inverted terminal** — a port whose `inverted` flag is set, rendered as a hollow ring
  just outside the pin (a logic negation bubble). Instance-level: templates keep clean
  (non-inverted) ports, and inversion lives on copies (preserved when a template is applied).
  Inversion is **external-only**: a component's own terminals as seen from *inside* (the
  `input-port`/`output-port` port groups) are never invertable and never show a bubble — you
  invert a terminal on a placed instance, never on the scope's own ports.
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
  hierarchy into fresh copies (live in the content tree, or embedded in the library when
  editing a template), so instances are independent from birth.
- **Grouping** — turning a selection into a composite (`inferGroup` → naming dialog →
  `applyGroup`); a single selected custom component is *promoted* to a template instead.
- **Apply template** — propagating a template's edits to every matching live copy in the current
  scope (same lineage `uuid` + same ordered port ids). Port names are ignored and overwritten
  from the template. Replaces internals, preserves external wiring and the copy's inversion.
- **Navigation (descend/ascend)** — the `navStack` of def ids; double-click a component to
  enter it, Escape / breadcrumb ↑ to exit.
- **Fit-to-view** — when you enter a component, the canvas auto-zooms/pans so its internals
  fill the view. A **viewport stack** (parallel to `navStack`) remembers the outgoing
  transform, so exiting restores the exact view you left.
- **Selection** — `selectedIds`; marquee (drag empty space), Shift+click to toggle, drag a
  selected component to move the whole selection.
- **Verilog export** — generating synthesizable Verilog from the serialized design (`@gatefold/verilog`,
  `exportVerilog(json)`): the JSON save format is the input, a `.v` module hierarchy is the output.
  One `module` per composite (root = top), gates as `assign`, the DFF as `always @(posedge clk)`
  with reset, buses as `[n-1:0]`, and probes as top-level I/O. Reports issues by severity: *errors*
  (floating nets, nested clocks) vs *info* (nested switches/sinks). Also exposed as a CLI and a
  toolbar button.
- **Copy-link sharing (`?d=`)** — encoding the whole design into a URL: serialized to JSON,
  gzip-compressed, then base64url-encoded into a `?d=` query parameter. Opening the URL restores
  the design on launch (taking precedence over any saved default).
- **Default program state** — a design stored in `localStorage` (`gatefold-default-design`) and
  restored automatically on launch, distinct from per-session edits. Backed by the *Save as default*
  / *Clear default* toolbar actions.
- **PNG primitive icons** — bundled raster icons (one per placeable primitive, mapped by
  `PrimitiveKind`) rendered in the library cards and sidebar tree in place of the text `glyph`.
- **Wire-crossing search** — reconstructing each connection's rendered bezier (de Casteljau-flattened)
  and intersecting it with a query segment to find the unique single-wire connection it crosses
  (null on ambiguity). Used by drop-to-split and the cut line.
- **Drop-to-split** — dropping a NODE onto an existing single wire splits it: the wire is replaced by
  `from → node.in:0` and `node.out:0 → to`.
- **Cut line** — a transient dashed line drawn while holding Ctrl/Cmd and dragging; on release it
  finds the single wire it crosses and inserts a NODE join-point there, slicing the wire.

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
- **Simulation speed (`timeScale`)** — a session-only multiplier mapping real time to simulated
  time (`1` = real-time). `run()` advances a fixed slice (`16 ms × timeScale`) of simulated
  picoseconds per tick, so increasing a CLOCK's period slows its visible toggle rate.
- **Timing lamp** — a green/yellow/red indicator shown when the design has exactly one clock. It
  latches a *half-period* breach (logic settles after the next clock edge) or a *full-period*
  breach (after a whole period), derived from gate delays vs. the clock period.
- **Signal coloring** — wires/markers colored by their simulated value: red = `1`, black = `0`,
  gray = `x`.
