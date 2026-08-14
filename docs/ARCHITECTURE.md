# Logica — Architecture & Design Summary

Status: work in progress. This document describes the design as it exists today.
`PLAN.md` holds the forward-looking roadmap; this document captures decisions that
have been implemented and the reasoning behind them.

---

## 1. Repository layout (pnpm monorepo)

```
/workspace
├── package.json            # root scripts: dev / build / test / typecheck
├── pnpm-workspace.yaml     # apps/*, packages/*
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
  inputs: number                            // arity
  outputs: number
  instances?: Instance[]                    // composite internals
  connections?: Connection[]
}

interface Instance {
  id: string
  name: string                              // unique within parent composite's scope
  defId: string                             // -> Design.defs
  pos: { x: number; y: number }             // canvas position
}

interface Connection {
  id: string
  from: { instanceId: string; portId: string } // output pin, or top-level input
  to:   { instanceId: string; portId: string } // input pin, or top-level output
}

interface Design { version: number; root: string; defs: Record<string, ComponentDef> }
```

### Key conventions

- **Definitions vs. instances**: a `ComponentDef` is a *type* (primitive or composite);
  an `Instance` is a *usage* with a name and position.
- **Port ids**: primitives expose implicit ports `in:0..n-1` (left side) and
  `out:0..m-1` (right side), via helpers `inputPortId`/`outputPortId`.
- **Hierarchy/scope**: instance names are unique within their parent composite;
  definition names are unique within the design (flat registry for now).
- **Primitive library** (`primitives.ts`): AND, OR, XOR, NOT, CLOCK. CLOCK is a source
  with 0 inputs and 1 output.

### Planned model change (not yet implemented)

To support grouping into named composites with named ports, the model will migrate
(see `PLAN.md` §3 and §7):

- Replace the `inputs`/`outputs` arity counts with an ordered `ports: Port[]`
  (ids stay `in:0..n-1` / `out:0..m-1`; names become user-editable).
- Introduce a `PinRef` union so a connection can target either an instance pin or the
  composite's own port:

  ```ts
  type PinRef =
    | { kind: 'instance'; instanceId: string; portId: string }
    | { kind: 'port'; portId: string }
  ```

  This lets a composite input fan out to multiple internal inputs and lets internal
  outputs drive composite outputs.

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
- `tool: 'select' | 'wire' | 'pan'` — active tool (not yet wired to behavior).
- Actions: `setTool`, `setViewport`, `setSelection`, `toggleSelected`,
  `setInstancesPosition`, `setMarquee`.

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
  output pins along the right edge.
- `instanceBounds(...)`, `hitTest(...)` — world-space bounds and topmost hit detection.

### Routing (`routing.ts`)
- `wirePath(a, b)` returns a cubic-bezier definition `{ start, c1, c2, end }`.
- Control-point offset = `abs(b.x - a.x) / 2`, with horizontal tangents at both ends
  (leaves the source pointing right, enters the target pointing left).
- Kept as a standalone abstraction so bus routing / orthogonal routing can slot in later.

### Rendering (`renderer.ts` + `palette.ts`)
- `drawScene(ctx, w, h, design, viewport, selectedIds, defId, marquee, palette)`:
  background → grid → wires → instances → marquee.
- **Theming**: colors come from `darkPalette` / `lightPalette` (no hardcoded canvas colors).
- **Gate shapes** drawn directly on canvas: AND (elliptical right side), OR/XOR
  (quadratic curves), NOT (triangle + bubble), CLOCK (rounded rect + sine glyph).
- **Wires** use two strokes:
  1. a thick "halo" in the background color, then
  2. the thin wire stroke.
  This makes crossings read as pass-over (not junctions).
- **Fan-out grouping**: connections are grouped by their source terminal; within a group
  all halos are drawn before all lines, so wires sharing an output render as one bundle.
- Selection is drawn as a dashed outline; the marquee as a translucent + dashed rect.

### Interactions (`Canvas.tsx`)
All pointer handling is attached natively to the `<canvas>`; the store drives redraws via
`subscribe`. World ↔ screen transforms account for pan/zoom.

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

- **Toolbar** — brand, tool buttons (select/wire/pan), simulation controls
  (run/step/stop/reset — placeholders), breadcrumb navigation, save/open JSON
  (placeholders), theme toggle.
- **Sidebar** (left) — component tree (instances of the current def, double-click to
  descend into composites) + a properties panel (name, type, arity, position; clock
  period when applicable). Reflects the current selection.
- **Library panel** (right) — palette of primitives + user components (currently
  non-functional place cards).
- **ResizeHandle** — draggable divider; widths are persisted via `uiStore`.
- **Theming** — CSS variables in `index.css`; `:root` = dark default,
  `:root[data-theme='light']` overrides. `App` sets `data-theme` on `<html>`, and an
  inline script in `index.html` applies it pre-hydration to avoid a flash.

---

## 6. Current gaps (not yet implemented)

- Simulation engine (combinational + sequential + hierarchy flattening).
- JSON serialize/deserialize + validation; wire the save/open buttons.
- Functional wire tool (drawing a wire between pins).
- **Group into composite** (see `PLAN.md` §7) — includes the `ports: Port[]` + `PinRef`
  model migration, the Group action + inference + review dialog, auto-rewire, the ports
  editor, and a library that lists composite defs.
- Simulation UI (run/step behavior, live signal coloring).
- Undo/redo, component naming/renaming.

---

## 7. Testing

- `packages/model/test/primitives.test.ts` — library contents, arity, port id helpers.
- `apps/logica/src/editor/routing.test.ts` — bezier control-point math and tangents.
- Run with `pnpm test`; typecheck with `pnpm typecheck`; build with `pnpm build`.
