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
interface Port { id: string; name: string; direction: PortDirection }

type PrimitiveKind = 'and' | 'or' | 'xor' | 'not' | 'clock'

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

// A connection endpoint: an instance pin, or the composite's own port.
type PinRef =
  | { kind: 'instance'; instanceId: string; portId: string }
  | { kind: 'port'; portId: string }

interface Connection {
  id: string
  from: PinRef
  to: PinRef
}

interface Design { version: number; root: string; defs: Record<string, ComponentDef> }
```

### Key conventions

- **Definitions vs. instances**: a `ComponentDef` is a *type* (primitive or composite);
  an `Instance` is a *usage* with a name and position.
- **Ports are named and ordered** (`ports: Port[]`, inputs first then outputs). Port ids
  stay index-based (`in:0..n-1`, `out:0..m-1`) so wiring is stable under renames; the
  `name` is a user-facing label.
- **Names are labels, ids are references.** Wiring (`PinRef.instanceId`), selection,
  navigation, and `Design.defs` all key off `id`s. The `name` is used only for display and
  for uniqueness at creation time, so renaming never breaks references.
- **`PinRef`** lets a composite input fan out to several internal inputs (multiple
  connections share a `{ kind: 'port' }` source) and lets internal outputs drive a
  composite output.
- **Primitive library** (`primitives.ts`): AND, OR, XOR, NOT, CLOCK. CLOCK is a source
  with 0 inputs and 1 output.
- **Grouping** (`group.ts`): pure `inferGroup` / `applyGroup` for turning a selection into
  a composite (see §6 for how it's exposed).

---

## 3. State management (`apps/logica/src/state`)

### `editorStore` — zustand + immer
The document and editing state:
- `design: Design` — the current design (currently a hardcoded demo).
- `navStack: string[]` — navigation path into composites; the top is the currently
  displayed definition. `navigateTo`/`navigateUp` descend/ascend.
- `viewport: { x, y, zoom }` — world point at canvas center + zoom factor.
- `selectedIds: string[]` — multi-selection (instance ids in the current def).
- `marquee: Rect | null` — transient marquee rectangle during rubber-band selection.
- `pendingGroup: { inputs, outputs } | null` — names collected in the group dialog.
- `tool: 'select' | 'wire' | 'pan'` — active tool (not yet wired to behavior).

Actions: `setTool`, `setViewport`, `setSelection`, `toggleSelected`,
`setInstancesPosition`, `setMarquee`, `navigateTo`, `navigateUp`, the group flow
(`openGroupDialog` / `setGroupInputName` / `setGroupOutputName` / `confirmGroup` /
`cancelGroup`), and port/instance editing (`renamePort`, `renameInstance`, `addPort`,
`removePort`).

Undo/redo middleware (`zundo`) is planned but not yet attached.

### `uiStore` — zustand + persist
UI preferences persisted to `localStorage` (`logica-ui`):
- `theme: 'light' | 'dark'`
- `sidebarWidth`, `libraryWidth` (resizable panel widths)

---

## 4. Editor (`apps/logica/src/editor`)

### Geometry (`geometry.ts`)
- `defBodySize(def)` — per-primitive body dimensions (composites use a fixed box).
- `portPosition(instance, def, portId)` — input pins distributed along the left edge,
  output pins along the right edge (order taken from `ports`).
- `instanceBounds(...)`, `hitTest(...)` — world-space bounds and topmost hit detection.

### Routing (`routing.ts`)
- `wirePath(a, b)` returns a cubic-bezier definition `{ start, c1, c2, end }`.
- Control-point offset = `abs(b.x - a.x) / 2`, with horizontal tangents at both ends
  (leaves the source pointing right, enters the target pointing left).
- Kept as a standalone abstraction so bus routing / orthogonal routing can slot in later.

### Rendering (`renderer.ts` + `palette.ts`)
- `drawScene(ctx, w, h, design, viewport, selectedIds, defId, marquee, palette)`:
  background → grid → wires → port terminals → instances → marquee.
- **Theming**: colors come from `darkPalette` / `lightPalette` (no hardcoded canvas colors).
- **Gate shapes** drawn directly on canvas: AND (elliptical right side), OR/XOR
  (quadratic curves), NOT (triangle + bubble), CLOCK (rounded rect + sine glyph).
- **Labels**: primitives show the type name above and the instance name below; composites
  show the instance name centered with the type name above, plus port names beside pins.
- **Port terminals**: when editing a composite, its own ports render as labeled terminals
  just outside the content bounds (inputs left, outputs right) — these are the
  `{ kind: 'port' }` endpoints that boundary wires connect to.
- **Wires** use two strokes:
  1. a thick "halo" in the background color, then
  2. the thin wire stroke.
  This makes crossings read as pass-over (not junctions).
- **Fan-out grouping**: connections are grouped by their source terminal; within a group
  all halos are drawn before all lines, so wires sharing an output render as one bundle.
- Selection is drawn as a dashed outline; the marquee as a translucent + dashed rect.

### Interactions (`Canvas.tsx`)
All pointer handling is attached natively to the `<canvas>`; the store drives redraws via
`subscribe`. World ↔ screen transforms account for pan/zoom. A `Drag` union models the
active gesture (`pan` / `move` / `marquee` / `shiftClick`).

- **Drag a component** → move it. If it is part of a multi-selection, the whole selection
  moves together.
- **Drag on empty background** (no modifier) → marquee; selects all intersecting
  instances (live during the drag).
- **Shift + click on a component** → toggle it in/out of the selection.
- **Shift + drag** → pan the viewport. A small movement threshold distinguishes a
  shift-click (toggle) from a shift-drag (pan).
- **Mouse wheel** → zoom anchored at the cursor.

---

## 5. UI shell (`apps/logica/src/ui`)

> Note: the contents of the side panels are provisional and will likely change
> significantly — treat the specifics below as placeholders, not a stable contract.

- **Toolbar** — brand, tool buttons (select/wire/pan), group action, simulation controls
  (run/step/stop/reset — placeholders), breadcrumb navigation, save/open JSON
  (placeholders), theme toggle. All icon buttons carry `title` tooltips.
- **Sidebar** (left) — component tree (instances of the current def, double-click to
  descend into composites), a properties panel (name — commits on Enter/blur — type,
  arity, position), and a **ports editor** (add/remove/rename the current composite's
  ports).
- **Library panel** (right) — palette of primitives + user components (derived from the
  design's composite defs).
- **GroupDialog** — modal that names the inferred input/output ports before creating a
  composite.
- **ResizeHandle** — draggable divider; widths are persisted via `uiStore`.
- **Theming** — CSS variables in `index.css`; `:root` = dark default,
  `:root[data-theme='light']` overrides. `App` sets `data-theme` on `<html>`, and an
  inline script in `index.html` applies it pre-hydration to avoid a flash.

---

## 6. Grouping into composite components

Implemented via `@logica/model`'s `group.ts` and driven by the toolbar **Group** button
(enabled with 2+ selected) and the `GroupDialog`.

- **`inferGroup(design, defId, ids)`** classifies each connection of the current def:
  both endpoints selected → internal; a selected input fed from outside → inferred input
  (grouped by the external net, so one net fans out to multiple pins); a selected output
  feeding outside → inferred output.
- **`applyGroup(design, defId, ids, inputNames, outputNames)`** clones the design, creates
  the new `ComponentDef` (ports from the names, moved instances kept at their positions,
  internal connections moved verbatim, boundary wiring re-expressed through
  `{ kind: 'port' }` endpoints), replaces the selection in the parent with a single
  instance at its centroid, and re-wires external connections to that instance's ports.

The result is a pure function (no mutation of its input) and is fully unit-tested.

---

## 7. Current gaps (not yet implemented)

- Simulation engine (combinational + sequential + hierarchy flattening).
- JSON serialize/deserialize + validation; wire the save/open buttons.
- Functional wire tool (drawing a wire between pins).
- Placing components from the library (cards are currently cosmetic).
- Simulation UI (run/step behavior, live signal coloring).
- Undo/redo; instance/definition name-uniqueness validation.

---

## 8. Testing

- `packages/model/test/primitives.test.ts` — library contents, arity, port ids.
- `packages/model/test/group.test.ts` — `inferGroup`/`applyGroup` (half-adder case and
  boundary rewiring).
- `apps/logica/src/editor/routing.test.ts` — bezier control-point math and tangents.
- Run with `pnpm test`; typecheck with `pnpm typecheck`; build with `pnpm build`.
