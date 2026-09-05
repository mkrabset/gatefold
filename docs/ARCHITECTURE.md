# Gatefold — Architecture & Design Summary

Status: work in progress. This document describes the design as it exists today.
`PLAN.md` holds the forward-looking roadmap; this document captures decisions that
have been implemented and the reasoning behind them.

---

## 1. Repository layout (pnpm monorepo)

```
/workspace
├── package.json            # root scripts: dev / build / test / typecheck / lint
├── pnpm-workspace.yaml     # apps/*, packages/*
├── README.md               # user-facing doc
├── PLAN.md                 # roadmap
├── docs/ARCHITECTURE.md    # this document
├── apps/
│   └── gatefold/             # @gatefold/app — Vite + React + TypeScript
└── packages/
    ├── model/              # @gatefold/model — shared domain model (no UI deps)
    ├── sim/                # @gatefold/sim — pure event-driven simulator (no UI deps)
    └── verilog/            # @gatefold/verilog — JSON → Verilog codegen (no UI deps)
```

- Package manager: **pnpm** (v11). Lockfile: `pnpm-lock.yaml`.
- `@gatefold/model` is consumed as raw TypeScript source via its `exports` field
  (`"exports": { ".": "./src/index.ts" }`), so no build step is needed.
- Tests: **Vitest**. The app runs with `jsdom`; the model/sim/verilog packages run in `node`.

---

## 2. Domain model (`@gatefold/model`)

Lives in `packages/model/src/`. Pure types + data — no framework dependencies.

```ts
type Signal = 0 | 1 | 'x'                       // 3-state logic

type PortDirection = 'input' | 'output'
interface Port {
  id: string
  name: string
  direction: PortDirection
  terminal?: { instanceId: string; pinId: string } // composite only: internal port instance
  inverted?: boolean                               // logical inversion (rendered as a bubble)
}

type PrimitiveKind =
  | 'and' | 'or' | 'xor' | 'not' | 'buffer' | 'clock' | 'fan-in' | 'fan-out'
  | 'bus-split' | 'bus-merge' | 'bus' | 'input-port' | 'output-port'
  | 'seven-seg' | 'switch-array' | 'led-array' | 'dff' | 'join-point'

// The model is a nested tree: a composite OWNS its children as inline objects.
// There is no flat id-lookup map (`defs`), no `variant` flag, and no `defId`
// back-reference — ownership is structural, so deleting a composite deletes its
// children for free.

interface CompositeDef {
  id: string            // identity label (templates, root, and copies all keep one)
  name: string
  kind: 'composite'
  ports: Port[]                             // ordered: inputs first, then outputs
  instances: Instance[]                     // owned children (inline defs)
  connections: Connection[]
  uuid?: string                             // lineage id: identity of an origin template, or the
                                            // soft link a copy carries back to its origin
  category?: string                         // library category (undefined = Uncategorized)
}

// A child def: the inline definition an instance actually holds. `builtin` is a shared,
// immutable primitive referenced by kind (the port groups + the join-point); `fork` is an
// owned primitive with its own ports (every placed primitive — per-instance `inverted` and
// array `terminalType`/wire-count live here); a composite is owned inline.
type ChildDef =
  | { kind: 'builtin'; primitive: PrimitiveKind }
  | { kind: 'fork';    primitive: PrimitiveKind; ports: Port[] }
  | CompositeDef

interface Instance {
  id: string
  name: string                              // display label; unique within parent's scope
  def: ChildDef                             // the owned child definition
  pos: { x: number; y: number }             // canvas position
  props?: Record<string, PropertyValue>     // per-instance property values (e.g. `lanes`, `order`)
}

// A JSON-scalar property value (`number | string | boolean`) — the only shapes
// `Instance.props` can hold, so props round-trip verbatim through serialization.
type PropertyValue = number | string | boolean

// A connection endpoint is always an instance pin.
type PinRef = { instanceId: string; portId: string }

interface Connection {
  id: string
  from: PinRef                               // driver (an output pin)
  to: PinRef                                 // sink (an input pin)
}

// The document: the root composite (the content tree) plus the component library
// (origin templates, keyed by id, each self-contained with inline embedded copies).
interface Design {
  version: number
  root: CompositeDef
  library: Record<string, CompositeDef>
}
```

### Key conventions

- **Definitions vs. instances**: a `ChildDef` (builtin / fork / composite) is a *type*;
  an `Instance` is a *usage* with a name and position, holding its def inline.
- **Ports are named and ordered** (`ports: Port[]`, inputs first then outputs). Port ids
  stay index-based (`in:0..n-1`, `out:0..m-1`) so wiring is stable under renames.
- **Names are labels, ids are references.** Wiring, selection, navigation, and
  `Design.library` all key off `id`s; `name` is only for display. Template
  names must be unique among templates (`templateNames`), but copies, built-ins, and the root
  do not collide (their names are ignored).
- **Ports are modeled as port-group instances.** Inside a composite, one `input-port`
  instance carries all of the composite's inputs (its pins are derived from `ports` and
  act as drivers), and one `output-port` instance carries all of its outputs (derived,
  acting as sinks). Each `Port` links back to its group via `Port.terminal`. This makes
  every connection a plain output→input wire and eliminates the internal "which way does
  a port flow" ambiguity. The composite's own pins (shown when it is used as an instance)
  come from `ports`.
- **Single-driver invariant**: each sink (`to`) has at most one incoming connection
  (`findConnectionTo`). Fan-out from a driver (`from`) is unrestricted.
- **Primitive library** (`primitives/`): built-in components are polymorphic — one
  `Primitive` class per kind in its own source file (`and.ts`, `or.ts`, `xor.ts`, `not.ts`,
  `buffer.ts`, `clock.ts`, `fan-in.ts`, `fan-out.ts`, `bus-split.ts`, `bus-merge.ts`,
  `bus.ts`, the internal `input-port.ts`/`output-port.ts`, the probe primitives
  `seven-seg.ts`/`switch-array.ts`/`led-array.ts`, and the sequential `dff.ts`). Each supplies its
  label/glyph, default ports, arity
  constraints (`fixedInputs` / `fixedOutputs`), terminal renaming (`allowRenameTerminals`),
  input-name suggestion, intrinsic bus width, body size, its own `draw(ctx, opts)` via a
  DOM-free `VectorContext`, and — for simulation — a **`transfer(inputs)`** combinational
  function (3-state `0`/`1`/`x`; sources/sinks return `[]`). The DFF is **stateful** instead:
  it declares `isSequential()`, `clockPortId()` (`in:1`) and `resetPortId()` (`in:2`), and its
  `transfer` returns `[]` — the engine evaluates it on clock edges (see §6c). The DFF exposes
  `Q` plus a complemented `!Q` output (`out:1`, inverted internally via `complementPortId()` —
  no bubble), driven by the engine's
  sequential path and exported as `assign !Q = ~Q;`. The registry
  (`index.ts`) maps a
  `PrimitiveKind` to its behaviour object; `forkOf(kind)` builds an owned primitive fork and
  `builtinOf(kind)` a shared builtin reference. The port primitives are not listed in the library (their pins are derived
  from the enclosing composite). The `not` gate is a `buffer` whose output port is `inverted`.
  The **NODE join-point** (`join-point`) is a single-wire passthrough with coincident terminals:
  its `coincidentTerminals()` drives special geometry (`portPosition` returns the body center,
  `instanceBodySize` stays a dot), `hitTestPort`'s `prefer` role disambiguates press (source) vs
  drop (sink), and the router collapses a wire's nearest control point onto the dot.
- **Buses**: a terminal's *width* (wire count) is derived, never stored. `portWidth` reports
  a primitive's intrinsic width (fan-in output / fan-out input = arity, else 1); the model's
  `widths.ts` solves the full width graph by fixpoint propagation (connection equalities,
  composite-terminal mirrors, and the `×2` relations of `bus-split`/`bus-merge` via
  `Primitive.deriveWidth`). `Primitive.intrinsicWidth(ports, port, props?)` takes the instance
  props so a primitive can fix its width from a property (the `bus` primitive returns `lanes`).
  An undetermined pin is neutral; a conflict, a non-integer result (odd bus into a splitter),
  or a failed `Primitive.widthError` constraint marks the sheet invalid — `widthError` carries
  a per-primitive validation message (e.g. the 7-seg requires a width divisible by 4 and ≤ 64).
- **Copy-on-place**: library templates are immutable. Placing or grouping deep-copies the
  template (and its whole internal hierarchy) into a fresh copy, so every instance owns its
  own content and edits never affect the template or sibling instances. A copy is always
  inline: a live copy is a nested composite under `root`, an embedded copy is nested inside a
  library template ("part of" it). A `uuid` **lineage id** is shared by a template
  and every copy derived from it (embedded or live), which is how "apply template" later finds
  an instance's origin — and it is a *soft link*: deleting a template clears the `uuid` on its
  copies rather than leaving a dangling pointer.
- **Template apply**: `apply.ts` (`scopeDefIds` / `portsMatch` / `applyTemplate`) propagates a
  template's edits to matching live copies in the current scope (current def + transitive nested
  defs). Matching requires the same lineage `uuid` and an unaltered interface (same ordered
  port ids; arity equal or either neutral). Port names are ignored during matching and
  overwritten from the template on apply. Inversion is treated as an external alteration and is
  preserved from the copy; internals are re-instantiated from the template while external
  wiring is kept intact.
- **Terminal inversion is instance-level**: templates keep clean (non-inverted) ports;
  `inverted` lives on copies. Grouping writes inversion onto the instance copy (not the
  template); the ports editor / `i` shortcut are disabled while editing a template. Built-in
  primitives (NOT, BUFFER) keep their intrinsic inverted outputs.
- **Custom properties**: a primitive declares its properties via `properties(): PropertySpec[]`
  (schema + default + unit/min/max/step; plus a `'select'` type with `options`). Per-instance
  values live in `Instance.props`, seeded at instantiation from the primitive's defaults and
  editable in the sidebar's properties panel.
- **Property-driven arity** (`switch-array`/`led-array`): the `terminalType` property
  (`wire`/`bus`) *changes the port count*. Since copy-on-place gives every placed
  primitive its own fork def, the store regenerates that fork's ports
  (`arrayPorts`) and prunes orphaned connections when the type changes (or a wire terminal is
  added/removed via the ports editor). In `bus` mode the single port is **neutral**
  (intrinsic `null`), adopting the connected width and rendering a `?` while undetermined.
- **Value entry** (`value.ts`): a `ValueFormat` (`HEX`/`DEC`/`SIGNED DEC`) shared by the 7-seg
  `mode` and the switch-array `valueFormat`, plus `ValueOrder` (`asc`/`desc`). Pure, BigInt-based
  `parseSwitchValue`/`formatSwitchValue` (LSB-first bits) and `applyValueOrder` (desc reverses)
  back the switch-array's **set-value dialog**; the switch's `valueFormat` is the dialog's initial
  radix and its `order` maps typed values onto lanes (asc = lane 0 is the LSB). `SevenSegMode` is
  gone — `sevenSegModeOf` now returns `ValueFormat`.
- **Clipboard** (`clipboard.ts`): pure `captureClipboard` / `instantiateClipboard` for in-app
  copy/paste with deep, id-rewritten copies of the selected inline subtrees.
- **Grouping** (`group.ts`): pure `inferGroup` / `applyGroup` (see §6).

---

## 3. State management (`apps/gatefold/src/state`)

### `editorStore` — zustand + immer + zundo
The document and editing state:
- `design: Design` — the current design. Starts from the stored launch default
  (`readDefaultState()`; see §8) when present, else an empty `main` sheet.
- `navStack: NavStep[]` — navigation path into composites; the top is the currently
  displayed definition. Each step is `{ kind: 'root' }`, `{ kind: 'instance'; id }` (descend
  into a placed instance), or `{ kind: 'template'; id }` (open a library template); the current
  def is resolved by walking from `design.root` (`resolveNav`). `navigateTo`/`navigateUp`
  descend/ascend.
- `viewport: { x, y, zoom }` — world point at canvas center + zoom factor.
- `viewportStack: Viewport[]` — a saved viewport per `navStack` depth; `navigateTo` saves the
  outgoing view and `navigateUp` restores it (so Escape returns to the exact view you left).
- `selectedIds: string[]` — multi-selection (instance ids in the current def).
- `marquee: Rect | null` — transient rubber-band rectangle.
- `pendingWire: { from, x, y, originalId? } | null` — a wire being drawn / re-targeted.
- `hoverPort: PinRef | null` — the terminal under the cursor (its marker lights up red).
- `notice: string | null` — transient rejection message (shown as a toast).
- `pendingGroup` — names collected in the group dialog.
- `fitToken: number` — incremented on design load (Open JSON / launch default) and on descent
  into a component (`navigateTo`) to request a one-shot fit-to-view from the canvas; excluded
  from undo history by `partialize`.

Actions: viewport/selection/marquee setters, navigation (`navigateTo`, `navigateUp`, and
`resetNavigation` — the last resets to the root and clears transient editing state, used by the
simulator on entering simulate mode), the group flow, port & instance
editing (`renamePort`, `renameInstance`, `addPort`, `removePort`, `setPortOrder`),
connection editing (`addConnection` with single-driver rejection, `retargetConnection`,
`removeConnection`), instance placement (`addInstance`, deep copy-on-place), and
clipboard/editing (`deleteSelection`, `copySelection`, `paste`). Loading/saving
(`loadProject`/`saveProject`) is joined by the default-state actions `saveDefault`/`clearDefault`
(see §8).

Undo/redo is provided by the **zundo `temporal`** middleware, `partialize`d to
`{ design }` (so viewport/selection/hover are not undoable). Drag moves are coalesced into
a single history entry via a `handleSet` coalescer driven by `beginMoveTransaction` /
`endMoveTransaction`. The in-memory clipboard is a module-level variable (not part of the
undoable state).

### `uiStore` — zustand + persist
UI preferences persisted to `localStorage` (`gatefold-ui`):
- `theme: 'light' | 'dark'`
- `sidebarWidth`, `libraryWidth` (resizable panel widths)

### `simStore` — zustand (simulation runtime, separate from `editorStore`)
- `mode: 'design' | 'simulate'` — the global toggle; entering simulate mode resets `navStack`
  to the root and builds a `Simulation` from the current `design`.
- `engine: Simulation | null` — the `@gatefold/sim` engine (rebuilt on `toggleMode`/`reset`/
  `setDefaultDelay`); it **never mutates the design**.
- `running`, `path` (instance-id path parallel to `navStack`), `version` (redraw trigger),
  `stepMode`, `defaultDelay`, `settingsOpen`, and `switchDialog` (the set-value dialog target:
  instance id, lane count, current lanes, format, and order).
- Actions: `toggleMode`, `run`/`step`/`stop`/`reset`, `toggleSwitch`, `openSwitchDialog`/
  `closeSwitchDialog`/`setSwitchValue` (the last drives `engine.setSwitchLanes` + `step`),
  `descend`/`ascend`, `setStepMode`/`setDefaultDelay`, `openSettings`/`closeSettings`.
- View helpers `simColorOf`/`simValueOf` (kept out of the store state) map a flattened pin's
  signal to a theme-aware wire color (`1`→red, `0`→black, `x`→gray).

---

## 4. Editor (`apps/gatefold/src/editor`)

### Geometry (`geometry.ts`)
- `defBodySize(def)` — base body dimensions (before pin radii).
- `pinRadiusWorld(width)` — a terminal marker's half-height (`3.5·width`, linear so each bus
  lane keeps a constant pitch).
- `sideHeight(widths)` / `sidePinOffset(widths, index)` — a terminal side is a **stack** of its
  markers with a constant `TERMINAL_GAP` between edges and `SIDE_PADDING` at the top/bottom;
  `sideHeight` is the side's total height, `sidePinOffset` the y of one pin relative to the
  side's center. `instanceBodySize(design, parentDef, instance, def)` takes
  `max(base, input side, output side)`; `sizeForPorts(widths)` does the same for a port group.
- `busWireOffsets(width)` — per-lane vertical offsets for a bus, inset one lane from each end
  of the marker (used to render individual wires).
- `portPosition(design, parentDef, instance, def, portId)` — input pins on the left edge,
  output pins on the right, stacked via `sidePinOffset`; port-group pins are derived from the
  parent's ports.
- `instanceBounds(design, parentDef, instance, def, pad)` / `hitTest(...)` — world-space
  bounds (using the effective size) and topmost hit detection.
- `defContentsBounds(design, def)` — union of a composite's instance bounds (used to frame the
  view when entering a component).
- `sevenSegLaneCount` / `arrayLaneCount` / `arrayIndicatorLanes` / `hitArrayIndicator` — the
  resolved digit/lane geometry for the 7-seg and array primitives, shared by the renderer and
  hit-testing (each indicator/segment sits at its terminal/lane's exact y, and each lane is
  clickable in simulate mode).
- `hitTestPort(wx, wy, instances, design, parentDef)` — nearest connectable pin, hit-tested
  against the whole terminal marker (a vertical segment of half-height `pinRadiusWorld(width)`),
  returning `{ ref, role }` where `role` is `source` (output pin) or `sink` (input pin).
- `pinWidth(design, parentDef, ref)` / `isNeutralPin(design, parentDef, ref)` — re-exported
  from `widths.ts`, which solves the whole sheet's widths by fixpoint propagation (see §2).
- `undeterminedHint(design, parentDef, ref)` — hover hint for an undetermined relation pin.
- `connectionError(design, def, from, to)` — runs the solver with a proposed wire and returns
  an error message if it would be invalid (used by `addConnection`/`retargetConnection`).

### Routing (`routing.ts`)
- `wirePath(a, b)` returns a cubic-bezier definition `{ start, c1, c2, end }`, with
  control-point offset `abs(b.x - a.x) / 2` and horizontal tangents at both ends.
- Kept as a standalone abstraction so bus / orthogonal routing can slot in later.

### Rendering (`renderer.ts` + `palette.ts`)
- `drawScene(ctx, w, h, def, viewport, selectedIds, editingTemplate, marquee, pendingWire,
  cutLine, hoverPort, palette, sim?)`: background → grid → wires → instances → hover highlight
  → marquee. `def` is the current `ChildDef` (a primitive shows the "internal circuitry"
  placeholder; a composite draws its instances).
- **Theming**: colors come from `darkPalette` / `lightPalette`.
- **Gate shapes**: AND (elliptical right side), OR/XOR (quadratic curves), NOT (triangle +
  bubble), CLOCK (rounded rect + zoom-scaled square-wave glyph), FAN-IN/FAN-OUT and
  BUS-SPLIT/BUS-MERGE (trapezoids, sized via shared `gateBounds`/`fillAndStroke`/
  `drawBusTrapezoid*` helpers).
- **Terminals**: each pin is a vertical **stroke** along the component edge (blue sink / green
  source), its length `2·pinRadiusWorld(width)`. Hovering a terminal turns its marker **red**
  (`pinHighlight`) instead of drawing a separate ring. A composite port wired to an internal
  fan-in/fan-out renders as a bus even from the outside; hovering a bus pin shows an `×n`
  arity tooltip. Gate shapes size their bus "neck" to the marker (`DrawOptions.pinRadius`).
- **Bus wires**: a bus is drawn as `n` individual single-wire beziers spread vertically across
  the pin marker (`busWireOffsets`, inset one lane from each end); each lane's control points
  translate with its endpoint. Undetermined wires still render as a single thin dashed wire.
  A bus drag preview renders the same `n` lanes as dashed beziers — spreading across a hovered
  sink, or converging on the cursor otherwise.
- **Port groups**: a single rectangle per direction. The `input-port` group draws its
  green source pins on the right edge (labels inside), the `output-port` group draws sink
  pins on the left edge. The group is movable as one unit.
- **Probes** (`switch-array`/`led-array`/`seven-seg`): arrays draw a row of indicator circles
  (or a `?` box while a bus width is undetermined), one per lane, each aligned to its terminal/
  bus lane; each circle fills red/amber when its lane is `1`. The 7-seg draws a body and
  renders one **hexagon-segment digit per 4-bit nibble** (lit vs unlit segments), MSD
  leftmost, honoring its `order` property; its body/border/segment colors come from the palette
  (`sevenSegFill`/`sevenSegStroke`/`sevenSegOff`/`sevenSegOn`), so they differ per theme. A
  switch-array also draws a small **`#` badge** in its body's top-left corner while simulating
  (via `switchValueBadge`, the shared geometry for its hit-test), opening the set-value dialog.
- **Inversion**: an inverted terminal draws hollow ring(s) shifted just outside the edge
  (touching the component at the pin). A single-wire terminal gets one bubble; a bus gets one
  small bubble per lane (aligned with each individual wire). Inversion is instance-level
  (templates stay clean); press `i` while hovering a terminal or use the ports-editor checkbox
  — both disabled while editing a template.
- **Labels**: primitives show type above and instance name below; composites show the
  instance name centered with the type above and port names beside the pins.
- **Wires**: two strokes — a thick background "halo" then the thin wire — so crossings read
  as pass-over. Wires sharing a source are grouped (all halos, then all lines) so fan-out
  renders as one bundle. A pending wire renders as a dashed preview.
- Selection is a dashed outline; the marquee is a translucent + dashed rect.

### Interactions (`Canvas.tsx`)
All pointer handling is attached natively to the `<canvas>`; the store drives redraws via
`subscribe`. A `Drag` union models the active gesture (`pan` / `move` / `marquee` /
`shiftClick` / `wire`).

- **Drag a component** → move it (the whole selection, if multi-selected).
- **Drag on empty background** → marquee select (live).
- **Shift + click** a component → toggle selection; **Shift + drag** → pan (a threshold
  distinguishes the two).
- **Mouse wheel** → zoom anchored at the cursor.
- **Double-click** a component → enter it (composites and gates alike); **Escape** (while
  the pointer is over the canvas) → exit back up one level.
- **Wiring**: press an output pin → draw a wire (its marker lights up red) → release on an
  input pin. Press an input pin that already has a wire → grab it → release on a new input to
  re-target, or on empty space to delete. Dropping onto an already-driven input is rejected
  (toast).

Global shortcuts (in `App.tsx`, ignored while typing): Ctrl/Cmd+C copy, Ctrl/Cmd+V paste,
Delete/Backspace delete, Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z / Ctrl/Cmd+Y redo.

---

## 5. UI shell (`apps/gatefold/src/ui`)

> Note: the contents of the side panels are provisional and will likely change
> significantly — treat the specifics below as placeholders, not a stable contract.

- **Toolbar** — brand, group action, **simulate/exit toggle** + Run/Step/Stop/Reset +
  settings (gear), breadcrumb navigation, save/open JSON, theme toggle. Icon buttons carry
  `title` tooltips.
- **Sidebar** (left) — component tree (double-click any component to descend; Escape exits),
  a **ports editor** for the current scope (shown first, with a divider), and a **properties
  panel** for the selected component: its name (commits on Enter/blur), its type, a generic
  editor for primitive `properties()` (number/string/boolean/select, unit in the label, via
  `setInstanceProp`), and an inline terminal editor (`PortsGroups`, parameterized by the
  instance's id). Port add/remove is gated by `fixedInputs`/`fixedOutputs`, rename by
  `allowRenameTerminals`; reorder is animated via @dnd-kit. The store port actions take an
  optional instance id, and `removePort` prunes the parent sheet's wires to a removed terminal.
- **Library panel** (right) — primitive palette + user composites (drag onto the canvas to
  place a deep copy; embedded copies are not listed as templates). The "My components" grid
  scrolls independently when it overflows.
- **GroupDialog** — names the inferred ports before creating a composite.
- **SimSettingsDialog** — modal for simulation settings: default gate delay (ps) and the
  step mode (`quiescent` / `clock-edge`).
- **Toast** — transient messages (e.g. "Input already has a driver").
- **ResizeHandle** — draggable dividers; widths persist via `uiStore`.
- **Theming** — CSS variables; `:root` dark, `:root[data-theme='light']` overrides, applied
  pre-hydration to avoid a flash.

---

## 6. Grouping into composite components

Implemented via `@gatefold/model`'s `group.ts`, driven by the toolbar **Group** button
(enabled with 2+ selected) and the `GroupDialog`.

- **`inferGroup(parent, ids)`** classifies each connection: both endpoints selected
  → internal; a selected input fed from outside → inferred input (grouped by external net);
  a selected output feeding outside → inferred output. It additionally *exposes* floating
  pins: a selected input with no incoming wire becomes an inferred input (no source) and a
  selected output with no outgoing wire becomes an inferred output (no targets), so unused
  terminals become ports wired only internally.
- **`applyGroup(design, parentId, ids, inputNames, outputNames)`** clones the design, creates
  the new `CompositeDef` (a library template, stamped with a fresh `uuid`), and for each
  inferred port creates an `input-port`/`output-port` group instance (linked via
  `Port.terminal`), wires the moved pins through those instances, then replaces the selection
  in the parent with a single instance at its centroid and re-wires the external connections
  to that instance's ports. Exposed (floating) ports are wired only internally — no external
  connection is created. The moved instances carry their inline defs into the template (no
  "relocate to library" step). The template's ports are **clean (non-inverted)**; inherited
  inversion is applied to the instance's copy by the store (`confirmGroup`) after
  copy-on-place (deep-clone of the template), so the instance never shares any data with the
  template.
- **Promote ("Save as template")** — selecting a single custom component and grouping copies
  its def into a new library template with a *fresh* `uuid` (independent of the original) and
  clean ports, leaving the instance and its live copy untouched.

Pure (no input mutation) and fully unit-tested.

---

## 6b. Applying template changes to instances

New `apps/gatefold/src/editor/apply.ts`, exposed via `applyTemplateToInstances(templateId)`:

- **Scope** — `scopeDefIds(root)` collects the nested composite subtree downward, so the
  apply reaches matching instances in the currently-viewed def and everything nested in it
  (including components inside a template being edited).
- **Matching** — a def is a candidate when it is a live copy with the template's `uuid`; it
  matches when its ports are unaltered (same ordered ids) and each port's arity is equal or
  either side neutral. Port names are ignored during matching; `inverted` is deliberately
  excluded (external).
- **Apply** — for each match, the template is deep-cloned and its internals spliced into the
  matching copy (its inline children come along by ownership); the copy keeps its id, port
  ids, `inverted` flags, and external wiring, and adopts the template's name, port names, and
  internals. Returns a count for the notice. Undoable via the normal history.

There is no orphan GC: children are owned inline, so deleting a composite deletes its
children structurally.

---

## 6c. Simulator (`@gatefold/sim`)

A pure, framework-free package (`packages/sim`, depends only on `@gatefold/model`). It reads a
`Design`, never mutates it, and exposes `Simulation`.

- **`netlist.ts`** — flattens the hierarchy through `Port.terminal` into leaf primitive
  instances + nets. A union-find unions connection endpoints and the composite-boundary ↔
  port-group pins; port-group and composite-boundary pins are dissolved into the same net.
  An **inverted composite terminal** is not dissolved: its boundary pin and internal
  port-group pin become separate nets joined by a synthesized inverter (a `buffer` flat
  instance whose output is `inverted`, i.e. a NOT), so an inverted input inverts on the way
  in and an inverted output on the way out — evaluated with the configured gate delay.
  Produces `instances`, `netWidths`, `driven[]`, and a **`pinNet`** map (every flattened pin
  key → net), so signals can be looked up for leaf, port-group, and composite pins alike
  (a boundary pin reads the raw external value; its internal port-group pin reads the
  inverted value).
- **`engine.ts`** — event-driven evaluation with **inertial** gate delays:
  - a min-heap of timed events; an input change schedules a gate's output at `now + delay`;
    versioned events supersede pending outputs (inertial).
  - `Simulation.step()` (`quiescent` = settle the combinational cascade, `clock-edge` = advance
    one clock edge then settle), `advanceTo(t)` (advance *through* all events up to `t`),
    `settle()` (flush pending gate events, stopping at the next clock edge — public so `run()`
    can leave the circuit settled each tick), `nextClockEdgeDelta()`, `setSwitch(id, value)` /
    `toggleSwitch(id, lane)` (per-lane switch state for `switch-array`), `signalOf(id, portId)` /
    `signal(id, portId)`.
  - **Event-driven clock**: each clock source keeps one pending edge event; when it fires the
    clock's net flips and the next edge is scheduled at `now + half` (`Instance.props.period`/2).
    So time advance is bounded ("process events ≤ t") rather than "settle until the queue is
    empty", and any clock period is captured without aliasing.
  - **Timing-breach detection** (single clock only): gate events carry the clock-edge time that
    triggered their cascade (`Event.edge`), and `evaluateGate` latches a **half-period breach**
    when an output settles later than `edge + half`, or a **full-period breach** when later than
    `edge + period`. Exposed as `timingHalfViolation`/`timingFullViolation` + `hasSingleClock()`
    + `resetTiming()`; the app shows a green/yellow/red toolbar lamp while a single clock is
    present.
  - **Power-on resolution**: driven nets initialize to `0` (floating stay `x`), then a
    zero-delay **Gauss-Seidel** pass settles feedback loops to a valid stable state; a per-net
    change counter detects true oscillators and freezes them at `x`. This breaks the `x`
    deadlock in gated feedback (e.g. a JK whose set/reset is gated by its own outputs).
  - **Sequential path**: a leaf whose primitive `isSequential()` (the DFF) is not a
    combinational gate. It is wired into `seqFanout` on its `clockPortId()` (and
    `resetPortId()`) net, and `evaluateSequential` — on a configured `edge` — samples `D` and
    schedules every output (`Q` and the internally-complemented `!Q`) at `now + delay`, applying
    each output's internal complement (`complementPortId()`) and terminal inversion; an asserted
    `RST` (`resetActiveHigh` selects polarity)
    forces the outputs to `initialValue` asynchronously, overriding the clock. Q powers on to
    `initialValue`; `lastClk` is seeded from the settled clock net after power-on.
- **`signals.ts`** — `invert` (delegates to the model's `invertSignal`),
  `invertVector`/`equalVectors`/`clockValue`.
- **`config.ts`** — `SimConfig { defaultDelay, perKindDelay, stepMode }` (delays in ps).

`Primitive.transfer(inputs: Signal[][]): Signal[][]` is the per-kind combinational function
(3-state; `0` dominates AND, `1` dominates OR, `x` propagates; fan-in concatenates, fan-out
splits, split/merge reshape). `Port.inverted` is applied by the engine at pin boundaries, so
NOT = buffer with an inverted output. Sources (CLOCK/SWITCH-ARRAY) and sinks
(LED-ARRAY/7-SEG) are driven/read by the engine rather than via `transfer`; sequential
primitives (DFF) are driven by the sequential path above.

Gate-built sequential is still supported: level-sensitive latches settle via feedback, and
edge-triggered master-slave flip-flops work via the inertial delay model (verified by the
master-slave JK test) — but the DFF primitive is the intended way to model registers, since it
evaluates as a true edge-triggered element and (later) exports to real FPGA flip-flops.

---

## 7. Current gaps (not yet implemented)

- Instance/definition name-uniqueness validation (rename collision is rejected among templates;
  instance names and non-template def names are otherwise not globally enforced).
- A global bus-width invariant scan (connections are validated at creation time; an
  inconsistent pre-existing design isn't proactively flagged).
- Timing-accurate simulation (glitch/setup-hold history, per-instance delays, SCC-based
  settling for large designs) — the engine is functional (unit/inertial delay), not
  timing-accurate.

---

## 8. Serialization & library exchange

- **`serialize.ts`** — `buildProject` / `serializeDesign` / `parseDesign` / `sanitizeDesign`.
  A saved design is `{ version, root: <nested composite>, library: { id: <nested composite> } }`
  (built-ins are inline `builtin` references, never stored as defs); `buildProject` rounds every
  `pos` coordinate to 2 decimals (sub-pixel) and sorts library keys for determinism.
  `parseDesign` validates the shape, migrates legacy files (a v1 two-part flat `library`+`defs`
  document, or the older flat-`variant` document, is inlined into the nested model), and throws
  on malformed input. `sanitizeDesign` drops dangling connections (endpoints referencing a
  missing instance); a dangling instance is structurally impossible.
- **`library.ts`** — `exportLibrary` / `importLibrary` (plus `serializeLibrary` / `parseLibrary`).
  The library is kept normalized in memory, so `exportLibrary` is simply `buildProject(design).library`
  — the **same code path** as Save JSON minus the content tree, so the library portion of a saved
  project and an exported library are byte-identical. Import deep-clones each origin template into
  `library` with fresh collision-free ids/names (never overwriting) and remaps composite `uuid`s
  consistently so an imported template and its embedded copies keep their shared soft link.
  `deleteTemplate` deletes a template and its owned children structurally, then clears the `uuid`
  soft link on remaining copies.
- **File I/O** lives in the app: the toolbar's Open/Save JSON buttons and the library
  panel's Export/Import buttons drive Blob downloads and a hidden file input. Load replaces
  the design and resets navigation/selection and the undo history.
- **Default state** (`apps/gatefold/src/state/defaultState.ts`) — a "default program state"
  stored in `localStorage` under `gatefold-default-design`. `saveDefaultState` / `clearDefaultState`
  back the toolbar's *Save as default* / *Clear default* buttons; `readDefaultState` restores it
  on launch (the store's initial `design`). `repairDesign(json)` is the shared parse/repair
  pipeline (parse → `sanitizeDesign` → lineage-`uuid` backfill) used by both `loadProject` and
  the launch restore.

## 8b. Verilog export (`@gatefold/verilog`)

A pure package (`packages/verilog`, depends only on `@gatefold/model`) that turns the serialized
design into synthesizable Verilog. The input is the same JSON `serializeDesign` produces; the
output is a `.v` module hierarchy — this keeps the generator fully decoupled from the app.

- **`exportVerilog(json): { source, issues }`** — `parseDesign` →
  `sanitizeDesign`, then a `Generator` walks the composite hierarchy and emits one `module` per
  composite (root = top module, children emitted first).
- **Per module** — a local union-find resolves connection endpoints into named nets (with widths
  from the model's width solver); port-group instances are dissolved so a composite's `ports`
  become the module ports. Gates emit as `assign` expressions (inversion is a `~`); the DFF emits
  `always @(posedge clk …)` with an async-reset branch and `INIT` from `initialValue`, plus an
  `assign !Q = ~Q;` for its inverted output; buses emit concatenation/slicing; child composites
  emit instantiations.
- **Probes** — CLOCK/SWITCHES become top-level `input`s, LEDS/7-SEG top-level `output`s. A nested
  switch is emitted as a constant at its `initialValue`; a nested clock or sink is not exported.
- **Issues by severity** — `{ level: 'info' | 'error', message }`: errors for floating nets, nested
  clocks, and dangling refs; info for nested switches/sinks. The app logs infos to the console and
  surfaces errors as a toast; the CLI (`tsx src/cli.ts`) prints them to stderr.
- Identifier sanitization + Verilog-keyword avoidance + collision dedup apply to module, port, and
  net names.

---

## 9. Testing

- `packages/model/test/primitives.test.ts` — library contents, arity, port ids, port defs,
  property defaults (clock `period`, bus `lanes`, 7-seg `order`), `widthError` cases, plus
  `isArrayDef`/`arrayDirection`, `sevenSegModeOf`, and `periodOf`.
- `packages/model/test/util.test.ts` — `uniqueId`, `walkComposites`, `allCompositeIds`,
  `findComposite`.
- `packages/model/test/value.test.ts` — `toValueFormat`/`valueFormatOf`/`valueOrderOf`,
  `parseSwitchValue` (HEX/DEC/signed ranges, invalid input), `formatSwitchValue`, `applyValueOrder`.
- `packages/model/test/array.test.ts` — `arrayPorts`, array WIRE/BUS defaults (incl. the new
  `valueFormat`/`order` props), and width constraints via `connectionError` (BUS fixes width;
  7-seg multiple-of-4 / ≤64).
- `packages/model/test/connections.test.ts` — `pinRefEquals` / `findConnectionTo` /
  `nextConnectionId`.
- `packages/model/test/group.test.ts` — `inferGroup`/`applyGroup` (port instances, boundary
  rewiring, exposed ports).
- `packages/model/test/clipboard.test.ts` — `captureClipboard` / `instantiateClipboard`.
- `packages/model/test/serialize.test.ts` — design round-trip and validation.
- `packages/model/test/library.test.ts` — library export closure/normalization and import
  merge/collision handling.
- `packages/model/test/transfer.test.ts` — `Primitive.transfer` 3-state truth tables and bus
  reshape.
- `packages/sim/test/engine.test.ts` — gates, `x` propagation, SR latch, gated JK, master-slave
  JK edge-triggering, oscillator → `x`, buses, clock square wave, clock-edge stepping,
  port-group/composite signal resolution, the DFF (posedge/negedge, async reset, initial value,
  shift register, composite), and switch-array lane setting (`setSwitchLanes`/`switchLanesOf`).
- `packages/verilog/test/verilog.test.ts` — gate emission (incl. XOR), inversion, DFF (with/without
  reset, negedge, `initialValue`, active-low reset), fan-in bus concatenation, bus-split slicing,
  nested composite modules, identifier sanitization, floating-net warning, and the nested-switch
  fixed-initial-value constant.
- `apps/gatefold/src/editor/routing.test.ts` — bezier control-point math and tangents.
- `apps/gatefold/src/editor/geometry.test.ts` — `pinWidth` / `isNeutralPin`.
- `apps/gatefold/src/state/editorStore.test.ts` — undo/redo (delete, drag coalescing,
  multi-step), copy/paste, and the single-driver + re-target rejection rules.
- Run with `pnpm test`; typecheck with `pnpm typecheck`; build with `pnpm build`.
