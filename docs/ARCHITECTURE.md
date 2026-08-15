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
}

type PrimitiveKind = 'and' | 'or' | 'xor' | 'not' | 'clock' | 'input-port' | 'output-port'

interface ComponentDef {
  id: string
  name: string
  kind: 'primitive' | 'composite'
  primitive?: PrimitiveKind                 // when kind === 'primitive'
  ports: Port[]                             // ordered: inputs first, then outputs
  instances?: Instance[]                    // composite internals
  connections?: Connection[]
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
- **Primitive library** (`primitives.ts`): AND, OR, XOR, NOT, CLOCK. The port primitives
  are not listed in the library (they are created/edited via the ports editor).
- **Grouping** (`group.ts`): pure `inferGroup` / `applyGroup` (see §6).

---

## 3. State management (`apps/logica/src/state`)

### `editorStore` — zustand + immer
The document and editing state:
- `design: Design` — the current design (currently a hardcoded demo).
- `navStack: string[]` — navigation path into composites; the top is the currently
  displayed definition. `navigateTo`/`navigateUp` descend/ascend.
- `viewport: { x, y, zoom }` — world point at canvas center + zoom factor.
- `selectedIds: string[]` — multi-selection (instance ids in the current def).
- `marquee: Rect | null` — transient rubber-band rectangle.
- `pendingWire: { from, x, y, originalId? } | null` — a wire being drawn / re-targeted.
- `hoverPort: { ref, action: 'create' | 'grab' } | null` — the port under the cursor.
- `notice: string | null` — transient rejection message (shown as a toast).
- `pendingGroup` — names collected in the group dialog.

Actions: viewport/selection/marquee setters, navigation, the group flow, port & instance
editing (`renamePort`, `renameInstance`, `addPort`, `removePort`), and connection editing
(`addConnection` with single-driver rejection, `retargetConnection`, `removeConnection`).

Undo/redo middleware (`zundo`) is planned but not yet attached.

### `uiStore` — zustand + persist
UI preferences persisted to `localStorage` (`logica-ui`):
- `theme: 'light' | 'dark'`
- `sidebarWidth`, `libraryWidth` (resizable panel widths)

---

## 4. Editor (`apps/logica/src/editor`)

### Geometry (`geometry.ts`)
- `defBodySize(def)` — per-primitive body dimensions (composites use a fixed box).
- `portPosition(instance, def, portId)` — input pins on the left edge, output pins on the
  right, evenly spaced.
- `instanceBounds(...)`, `hitTest(...)` — world-space bounds and topmost hit detection.
- `hitTestPort(wx, wy, instances, design)` — nearest connectable pin within a radius,
  returning `{ ref, role }` where `role` is `source` (output pin) or `sink` (input pin).

### Routing (`routing.ts`)
- `wirePath(a, b)` returns a cubic-bezier definition `{ start, c1, c2, end }`, with
  control-point offset `abs(b.x - a.x) / 2` and horizontal tangents at both ends.
- Kept as a standalone abstraction so bus / orthogonal routing can slot in later.

### Rendering (`renderer.ts` + `palette.ts`)
- `drawScene(ctx, w, h, design, viewport, selectedIds, defId, marquee, pendingWire,
  hoverPort, palette)`: background → grid → wires → instances → hover highlight → marquee.
- **Theming**: colors come from `darkPalette` / `lightPalette`.
- **Gate shapes**: AND (elliptical right side), OR/XOR (quadratic curves), NOT (triangle +
  bubble), CLOCK (rounded rect + sine glyph).
- **Port groups**: a single rectangle per direction. The `input-port` group draws its
  green source pins on the right edge (labels inside), the `output-port` group draws sink
  pins on the left edge. The group is movable as one unit.
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
- **Wiring**: press an output pin (yellow hover) → draw a wire → release on an input pin.
  Press an input pin that already has a wire (orange hover) → grab it → release on a new
  input to re-target, or on empty space to delete. Dropping onto an already-driven input is
  rejected (toast).

---

## 5. UI shell (`apps/logica/src/ui`)

> Note: the contents of the side panels are provisional and will likely change
> significantly — treat the specifics below as placeholders, not a stable contract.

- **Toolbar** — brand, group action, simulation controls (placeholders), breadcrumb
  navigation, save/open JSON (placeholders), theme toggle. Icon buttons carry `title`
  tooltips.
- **Sidebar** (left) — component tree (double-click a composite to descend), properties
  panel (name commits on Enter/blur), and a **ports editor** (add/remove/rename the current
  composite's ports; each port is backed by the composite's port-group instances).
- **Library panel** (right) — primitive palette + user composites (drag onto the canvas to
  place an instance).
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
  a selected output feeding outside → inferred output.
- **`applyGroup(design, defId, ids, inputNames, outputNames)`** clones the design, creates
  the new `ComponentDef`, and for each inferred port creates an `input-port`/`output-port`
  instance (linked via `Port.terminal`), wires the moved pins through those instances, then
  replaces the selection in the parent with a single instance at its centroid and re-wires
  the external connections to that instance's ports.

Pure (no input mutation) and fully unit-tested.

---

## 7. Current gaps (not yet implemented)

- Simulation engine (combinational + sequential + hierarchy flattening).
- JSON serialize/deserialize + validation; wire the save/open buttons.
- Simulation UI (run/step behavior, live signal coloring).
- Undo/redo; instance/definition name-uniqueness validation.
- Multi-bit buses (single wires only for now).

---

## 8. Testing

- `packages/model/test/primitives.test.ts` — library contents, arity, port ids, port defs.
- `packages/model/test/connections.test.ts` — `pinRefEquals` / `findConnectionTo`.
- `packages/model/test/group.test.ts` — `inferGroup`/`applyGroup` (port instances, boundary
  rewiring).
- `apps/logica/src/editor/routing.test.ts` — bezier control-point math and tangents.
- Run with `pnpm test`; typecheck with `pnpm typecheck`; build with `pnpm build`.
