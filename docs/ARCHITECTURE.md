# Logica — Architecture & Design Summary

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
│   └── logica/             # @logica/app — Vite + React + TypeScript
└── packages/
    └── model/              # @logica/model — shared domain model (no UI deps)
```

- Package manager: **pnpm** (v11). Lockfile: `pnpm-lock.yaml`.
- `@logica/model` is consumed as raw TypeScript source via its `exports` field
  (`"exports": { ".": "./src/index.ts" }`), so no build step is needed.
- Tests: **Vitest**. The app runs with `jsdom`; the model package runs in `node`.

---

## 2. Domain model (`@logica/model`)

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
  | 'bus-split' | 'bus-merge' | 'input-port' | 'output-port'

interface ComponentDef {
  id: string
  name: string
  kind: 'primitive' | 'composite'
  primitive?: PrimitiveKind                 // when kind === 'primitive'
  ports: Port[]                             // ordered: inputs first, then outputs
  instances?: Instance[]                    // composite internals
  connections?: Connection[]
  variant?: boolean                         // true = instance-local fork (hidden from library)
  uuid?: string                             // lineage id: shared by a template and its variants
}

interface Instance {
  id: string
  name: string                              // display label; unique within parent's scope
  defId: string                             // -> Design.defs
  pos: { x: number; y: number }             // canvas position
}

// A connection endpoint is always an instance pin.
type PinRef = { instanceId: string; portId: string }

interface Connection {
  id: string
  from: PinRef                               // driver (an output pin)
  to: PinRef                                 // sink (an input pin)
}

interface Design { version: number; root: string; defs: Record<string, ComponentDef> }
```

### Key conventions

- **Definitions vs. instances**: a `ComponentDef` is a *type* (primitive or composite);
  an `Instance` is a *usage* with a name and position.
- **Ports are named and ordered** (`ports: Port[]`, inputs first then outputs). Port ids
  stay index-based (`in:0..n-1`, `out:0..m-1`) so wiring is stable under renames.
- **Names are labels, ids are references.** Wiring, selection, navigation, and
  `Design.defs` all key off `id`s; `name` is only for display and uniqueness.
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
  `buffer.ts`, `clock.ts`, `fan-in.ts`, `fan-out.ts`, plus the internal
  `input-port.ts`/`output-port.ts`). Each supplies its label/glyph, default ports, arity
  constraints (`fixedInputs` / `fixedOutputs`), terminal renaming (`allowRenameTerminals`),
  input-name suggestion, intrinsic bus width, body size, and its own `draw(ctx, opts)` via a
  DOM-free `VectorContext`. The registry (`index.ts`) maps a `PrimitiveKind` to its behaviour
  object; `primitiveDef(kind)` produces the serializable `ComponentDef`. The port primitives
  are not listed in the library (their pins are derived from the enclosing composite). The
  `not` gate is a `buffer` whose output port is `inverted`.
- **Buses**: a terminal's *width* (wire count) is derived, never stored. `portWidth` reports
  a primitive's intrinsic width (fan-in output / fan-out input = arity, else 1); the editor's
  `widths.ts` solves the full width graph by fixpoint propagation (connection equalities,
  composite-terminal mirrors, and the `×2` relations of `bus-split`/`bus-merge` via
  `Primitive.deriveWidth`). An undetermined pin is neutral; a conflict or non-integer result
  (odd bus into a splitter) marks the sheet invalid.
- **Copy-on-place**: library templates are immutable. Placing or grouping deep-copies the
  template (and its whole internal hierarchy) into `variant: true` defs, so every instance
  owns its own content and edits never affect the template or sibling instances. A `uuid`
  **lineage id** is shared by a template and its variants (and preserved by every copy), which
  is how "apply template" later finds an instance's origin.
- **Template apply**: `apply.ts` (`scopeDefIds` / `portsMatch` / `applyTemplate`) propagates a
  template's edits to matching variants in the current scope (current def + transitive nested
  defs). Matching requires the same lineage `uuid` and an unaltered interface (port ids/names/
  order; arity equal or either neutral). Inversion is treated as an external alteration and is
  preserved from the variant; internals are re-instantiated from the template while external
  wiring is kept intact.
- **Terminal inversion is instance-level**: templates keep clean (non-inverted) ports;
  `inverted` lives on variants. Grouping writes inversion onto the instance variant (not the
  template); the ports editor / `i` shortcut are disabled while editing a template. Built-in
  primitives (NOT, BUFFER) keep their intrinsic inverted outputs.
- **Custom properties**: a primitive declares its properties via `properties(): PropertySpec[]`
  (schema + default + unit/min/max/step). Per-instance values live in `Instance.props`,
  seeded at instantiation from the primitive's defaults and editable in the sidebar's
  properties panel.
- **Clipboard** (`clipboard.ts`): pure `copyDefSubgraph` / `captureClipboard` /
  `instantiateClipboard` for in-app copy/paste with deep, id-rewritten copies.
- **Grouping** (`group.ts`): pure `inferGroup` / `applyGroup` (see §6).

---

## 3. State management (`apps/logica/src/state`)

### `editorStore` — zustand + immer + zundo
The document and editing state:
- `design: Design` — the current design (currently a hardcoded demo).
- `navStack: string[]` — navigation path into composites; the top is the currently
  displayed definition. `navigateTo`/`navigateUp` descend/ascend.
- `viewport: { x, y, zoom }` — world point at canvas center + zoom factor.
- `selectedIds: string[]` — multi-selection (instance ids in the current def).
- `marquee: Rect | null` — transient rubber-band rectangle.
- `pendingWire: { from, x, y, originalId? } | null` — a wire being drawn / re-targeted.
- `hoverPort: PinRef | null` — the terminal under the cursor (its marker lights up red).
- `notice: string | null` — transient rejection message (shown as a toast).
- `pendingGroup` — names collected in the group dialog.

Actions: viewport/selection/marquee setters, navigation, the group flow, port & instance
editing (`renamePort`, `renameInstance`, `addPort`, `removePort`, `setPortOrder`),
connection editing (`addConnection` with single-driver rejection, `retargetConnection`,
`removeConnection`), instance placement (`addInstance`, deep copy-on-place), and
clipboard/editing (`deleteSelection`, `copySelection`, `paste`).

Undo/redo is provided by the **zundo `temporal`** middleware, `partialize`d to
`{ design }` (so viewport/selection/hover are not undoable). Drag moves are coalesced into
a single history entry via a `handleSet` coalescer driven by `beginMoveTransaction` /
`endMoveTransaction`. The in-memory clipboard is a module-level variable (not part of the
undoable state).

### `uiStore` — zustand + persist
UI preferences persisted to `localStorage` (`logica-ui`):
- `theme: 'light' | 'dark'`
- `sidebarWidth`, `libraryWidth` (resizable panel widths)

---

## 4. Editor (`apps/logica/src/editor`)

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
- `drawScene(ctx, w, h, design, viewport, selectedIds, defId, marquee, pendingWire,
  hoverPort, palette)`: background → grid → wires → instances → hover highlight → marquee.
- **Theming**: colors come from `darkPalette` / `lightPalette`.
- **Gate shapes**: AND (elliptical right side), OR/XOR (quadratic curves), NOT (triangle +
  bubble), CLOCK (rounded rect + sine glyph), FAN-IN/FAN-OUT and BUS-SPLIT/BUS-MERGE
  (trapezoids, sized via shared `gateBounds`/`fillAndStroke`/`drawBusTrapezoid*` helpers).
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

## 5. UI shell (`apps/logica/src/ui`)

> Note: the contents of the side panels are provisional and will likely change
> significantly — treat the specifics below as placeholders, not a stable contract.

- **Toolbar** — brand, group action, simulation controls (placeholders), breadcrumb
  navigation, save/open JSON (placeholders), theme toggle. Icon buttons carry `title`
  tooltips.
- **Sidebar** (left) — component tree (double-click any component to descend; Escape exits),
  properties panel (name commits on Enter/blur; a selected primitive with `properties()`
  shows a generic editor — number/string/boolean, unit in the label — committing via
  `setInstanceProp`), and a **ports editor** (add/remove/rename/
  reorder ports; add/remove is gated by the primitive's `fixedInputs`/`fixedOutputs`, rename
  by `allowRenameTerminals`; reorder is animated via @dnd-kit).
- **Library panel** (right) — primitive palette + user composites (drag onto the canvas to
  place a deep copy; `variant` defs are excluded).
- **GroupDialog** — names the inferred ports before creating a composite.
- **Toast** — transient messages (e.g. "Input already has a driver").
- **ResizeHandle** — draggable dividers; widths persist via `uiStore`.
- **Theming** — CSS variables; `:root` dark, `:root[data-theme='light']` overrides, applied
  pre-hydration to avoid a flash.

---

## 6. Grouping into composite components

Implemented via `@logica/model`'s `group.ts`, driven by the toolbar **Group** button
(enabled with 2+ selected) and the `GroupDialog`.

- **`inferGroup(design, defId, ids)`** classifies each connection: both endpoints selected
  → internal; a selected input fed from outside → inferred input (grouped by external net);
  a selected output feeding outside → inferred output. It additionally *exposes* floating
  pins: a selected input with no incoming wire becomes an inferred input (no source) and a
  selected output with no outgoing wire becomes an inferred output (no targets), so unused
  terminals become ports wired only internally.
- **`applyGroup(design, defId, ids, inputNames, outputNames)`** clones the design, creates
  the new `ComponentDef` (a library template, stamped with a fresh `uuid`), and for each
  inferred port creates an `input-port`/`output-port` group instance (linked via
  `Port.terminal`), wires the moved pins through those instances, then replaces the selection
  in the parent with a single instance at its centroid and re-wires the external connections
  to that instance's ports. Exposed (floating) ports are wired only internally — no external
  connection is created. The template's ports are **clean (non-inverted)**; inherited
  inversion is applied to the instance's variant by the store (`confirmGroup`) after
  copy-on-place (`copyDefSubgraph`), so the instance never shares any data with the template.
- **Promote ("Save as template")** — selecting a single custom component and grouping copies
  its def into a new library template with a *fresh* `uuid` (independent of the original) and
  clean ports, leaving the instance and its variant untouched.

Pure (no input mutation) and fully unit-tested.

---

## 6b. Applying template changes to instances

New `apps/logica/src/editor/apply.ts`, exposed via `applyTemplateToInstances(templateId)`:

- **Scope** — `scopeDefIds(design, currentDefId)` BFSs instance references downward, so the
  apply reaches matching instances in the currently-viewed def and everything nested in it
  (including components inside a template being edited).
- **Matching** — a def is a candidate when it is a `variant` with the template's `uuid`; it
  matches when its ports are unaltered (same ordered ids and names) and each port's arity is
  equal or either side neutral. `inverted` is deliberately excluded (external).
- **Apply** — for each match, `copyDefSubgraph` re-instantiates the template's internals
  (fresh nested variant closure); the variant keeps its id, port ids, `inverted` flags, and
  external wiring, and adopts the template's name and internals. Returns a count for the
  notice. Undoable via the normal history.

Known limitation: applying orphans the variant's old nested closure defs (no def GC yet).

---

## 7. Current gaps (not yet implemented)

- Simulation engine (combinational + sequential + hierarchy flattening).
- Simulation UI (run/step behavior, live signal coloring).
- Instance/definition name-uniqueness validation.
- A global bus-width invariant scan (connections are validated at creation time; an
  inconsistent pre-existing design isn't proactively flagged).
- Def reachability GC (applying a template orphans its variant's old nested defs).

---

## 8. Serialization & library exchange

- **`serialize.ts`** — `serializeDesign` / `parseDesign`. A saved design is self-contained:
  the entire `Design` (primitive defs, port-group defs, composites, and `variant` copies) is
  serialized verbatim. `parseDesign` validates the shape and throws on malformed input.
- **`library.ts`** — `exportLibrary` / `importLibrary` (plus `serializeLibrary` /
  `parseLibrary`). Export collects the template composites and their transitive composite
  closure, deep-cloned with `variant` stripped and references to primitive defs normalized to
  built-in ids. Import merges with fresh collision-free ids/names (never overwriting), assigns
  fresh lineage `uuid`s, and remaps internal references.
- **File I/O** lives in the app: the toolbar's Open/Save JSON buttons and the library
  panel's Export/Import buttons drive Blob downloads and a hidden file input. Load replaces
  the design and resets navigation/selection and the undo history.

---

## 9. Testing

- `packages/model/test/primitives.test.ts` — library contents, arity, port ids, port defs.
- `packages/model/test/connections.test.ts` — `pinRefEquals` / `findConnectionTo`.
- `packages/model/test/group.test.ts` — `inferGroup`/`applyGroup` (port instances, boundary
  rewiring, exposed ports).
- `packages/model/test/clipboard.test.ts` — `copyDefSubgraph` / `captureClipboard` /
  `instantiateClipboard`.
- `packages/model/test/serialize.test.ts` — design round-trip and validation.
- `packages/model/test/library.test.ts` — library export closure/normalization and import
  merge/collision handling.
- `apps/logica/src/editor/routing.test.ts` — bezier control-point math and tangents.
- `apps/logica/src/editor/geometry.test.ts` — `pinWidth` / `isNeutralPin`.
- `apps/logica/src/state/editorStore.test.ts` — undo/redo (delete, drag coalescing,
  multi-step) and copy/paste.
- Run with `pnpm test`; typecheck with `pnpm typecheck`; build with `pnpm build`.
