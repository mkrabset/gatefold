# Logica — Implementation Plan

A graphical designer and simulator for logic circuitry. Runs in the browser, built on
TypeScript, React, and Zustand. Circuits are composed of components (gates, clock
sources, and user-defined sub-circuits) wired together and simulated with sequential
(clocked) behavior.

> The current "as-built" state is tracked separately in `docs/ARCHITECTURE.md`. This
> document is the forward-looking roadmap.

---

## 1. Goals

1. Place components from a component library onto a pannable/zoomable canvas.
2. Wire components together to form circuits.
3. Simulate the circuit, including clocked (sequential) behavior.
4. Group a circuit into a **named component** (declared inputs/outputs) and reuse it as a
   sub-component elsewhere — arbitrary hierarchical nesting.
5. Browse the component hierarchy in a sidebar and inspect properties of each sub-component.
6. Save and load designs as JSON files.

---

## 2. Tech stack & tooling

- **pnpm monorepo**: `apps/logica` (`@logica/app`) + `packages/model` (`@logica/model`),
  where `@logica/model` holds the pure domain model (no UI deps) and is consumed as source.
- **Vite + React 19 + TypeScript** (strict mode).
- **Zustand** (state management) + **immer** (immutable updates) + **zundo** (undo/redo,
  planned).
- **HTML5 `<canvas>`** for the schematic editor, backed by a retained scene-graph model with
  manual hit-testing.
- **Vitest** for unit tests (simulator and data model are the correctness-critical parts).
- No backend. Designs are JSON files on disk.

---

## 3. Core data model (`@logica/model`)

The model cleanly separates **definitions** (types) from **instances** (usages).

```ts
type Signal = 0 | 1 | 'x'; // 3-state logic (0, 1, unknown)

interface Port { id: string; name: string; direction: 'input' | 'output' }

type PrimitiveKind = 'and' | 'or' | 'xor' | 'not' | 'clock';

interface ComponentDef {
  id: string;
  name: string;                 // unique within its scope
  kind: 'primitive' | 'composite';
  primitive?: PrimitiveKind;    // present when kind === 'primitive'
  ports: Port[];                // ordered: inputs first (in:0..n-1), then outputs (out:0..m-1)
  // Composite internals:
  instances?: Instance[];       // sub-components
  connections?: Connection[];   // netlist wiring internal pins
}

interface Instance {
  id: string;
  name: string;                 // unique within the parent composite's scope
  defId: string;                // reference into Design.defs
  pos: { x: number; y: number }; // canvas placement
}

// A connection endpoint is either an instance's pin or the composite's own port.
type PinRef =
  | { kind: 'instance'; instanceId: string; portId: string }
  | { kind: 'port'; portId: string };

interface Connection {
  id: string;
  from: PinRef;                 // output pin, or a composite input port
  to: PinRef;                   // input pin, or a composite output port
}

interface Design {
  version: number;
  root: string;                 // id of the root composite definition
  defs: Record<string, ComponentDef>;
}
```

### Hierarchy / scope rules

- A composite's internal instance names are unique **within that composite**.
- Component definition names are unique **within the design** (flat registry is sufficient
  for the MVP; namespacing can be added later).
- Composites may nest arbitrarily; cycle detection in the instance graph is deferred until
  the simulation engine needs it.

### Port conventions

- Ports are **named** (`Port.name`) and ordered (`ports` array). `id`s stay index-based
  (`in:0..n-1`, `out:0..m-1`) so wiring is stable under renames.
- Inputs are rendered on the **left** edge, outputs on the **right** edge (see §6).

---

## 4. Component library

The palette of primitives, initially:

- **AND** (2 inputs, 1 output)
- **OR** (2 inputs, 1 output)
- **XOR** (2 inputs, 1 output)
- **NOT** (1 input, 1 output)
- **CLOCK** (0 inputs, 1 output)

Notes:

- **CLOCK** is a special source: it has no behavioral inputs and produces a periodic square
  wave. It carries a configurable period/frequency.
- Primitives carry a *behavior* (truth table / clock generator) used by the simulator.
- User-defined **composite** components appear in the library once created, for placement
  and reuse.

---

## 5. Simulation engine (`src/sim`)

- **Signal model:** 3-state logic — `0`, `1`, `X`. Floating inputs and uninitialized state
  drive `X`, which is essential for correct sequential behavior. (`Z` high-impedance is
  deferred.)
- **Event-driven propagation:** changes are queued in a timestamp-ordered event queue and
  fanned out to connected inputs; recomputed outputs propagate onward.
- **Clock:** an independent oscillator (no inputs) producing a periodic square wave; it
  drives the global simulated time base for sequential elements.
- **Sequential:** flip-flops/latches sample on a clock edge and schedule a delayed update
  (unit delay), yielding stable clocked behavior.
- **Hierarchy flattening:** the engine walks the instance graph, mapping composite ports to
  internal pins, so a single pass simulates arbitrary depth.
- **Cycle handling:** combinational loops are detected and drive involved nets to `X`
  rather than hanging.
- The engine is a pure, framework-free module (inputs/outputs are maps of pin → value) so it
  is fully unit-testable.

---

## 6. Editor & UI (`src/editor` + `src/ui`)

### Rendering convention (all components)

- Inputs are always on the **left** edge, outputs on the **right** edge, vertically
  distributed; the gate body is drawn between them.
- Composite *instances* render as a box with ports on left/right; port names are shown
  next to the pins.

### Wires

- **Cubic-bezier curves** routed by `routing.ts` (`wirePath`), with horizontal tangents at
  both ends and control-point offset `abs(dx) / 2`.
- A background-color **halo** stroke under each wire makes crossings read as pass-over.
- Wires sharing a source terminal are grouped (all halos, then all lines) so fan-out renders
  as a single bundle.

### Interactions

- **Drag a component** → move it; if part of a multi-selection, the whole selection moves.
- **Drag on empty background** (no modifier) → marquee (rubber-band) selection.
- **Shift + click a component** → toggle it in/out of the selection.
- **Shift + drag** → pan the viewport (a small threshold distinguishes click from drag).
- **Mouse wheel** → zoom in/out (anchored at the cursor).
- **Drag from an output pin to an input pin** → create a wire (planned; the "wire" tool is
  currently a placeholder).
- During simulation, wires/pins are colored live by their signal value (`0`/`1`/`X`).

### Panels

- **Sidebar (left):**
  - Component tree (composite → instances → ports).
  - Click selects; **double-click a composite instance descends** into its definition;
    a breadcrumb trail ascends back up.
  - **Properties panel** shows/edits name, port names, primitive kind, clock period, etc.
  - **Ports editor** for the currently-viewed composite: add/remove/rename its ports.
- **Library panel:** palette to pick a component to place, plus the user's composite
  components (derived from the design, not hardcoded).
- **Toolbar:** tools, simulation controls (run/step/stop/reset), save/load JSON, theme
  toggle, and a **Group** action.

---

## 7. Grouping into composite components

> Implemented (see `docs/ARCHITECTURE.md` §6). The workflow below documents the design.

Turn a selection of components into a reusable named component (e.g. build a full/half
adder from gates).

### Workflow

1. Multi-select **2+ instances** in the current def.
2. Click **Group** (toolbar, enabled only when the selection qualifies).
3. Classify each connection: both endpoints selected → **internal**; otherwise → a
   **boundary crossing**.
4. **Infer ports** from the boundary crossings:
   - inputs = distinct *external nets* feeding selected input pins (one net → one input,
     fanned out internally to all the pins it feeds);
   - outputs = distinct selected output pins feeding outside.
5. Show a **review dialog** listing the inferred inputs/outputs with editable names
   (auto-names `in1`, `out1`). Confirm to create.
6. `applyGroup` then:
   - creates the new `ComponentDef` (unique name, inferred `ports`, moved `instances`
     kept at their current positions, and internal connections);
   - removes the selected instances and all touching connections from the parent;
   - inserts a single instance of the new def at the bounding-box center;
   - re-adds external connections to that instance's ports (auto-rewire).
7. The new component appears in the Library's "My components" list.

### Editing later

- The composite's ports remain fully editable: add/remove/rename via the **ports editor**.
  Adding/removing a port adds/removes the corresponding port terminal.
- Manually rewiring port↔pin connections depends on the **wire tool** becoming functional.

### Deferred

- Cycle detection for nested composites, undo/redo integration, name-uniqueness validation.

---

## 8. State management (`src/state`)

Zustand stores, split by concern:

- `editorStore` — the `Design` document (definitions, instances, connections) via immer,
  plus tool, viewport, multi-selection, marquee, and navigation stack. (zundo to be attached
  for undo/redo.)
- `uiStore` — theme, panel widths, and other persisted UI preferences.
- `simStore` — (planned) running/paused, simulated time, current pin values, clock state.

---

## 9. JSON file format

The `Design` object is serialized verbatim, with a schema `version` field for future
migration. Primitive definitions are referenced by stable kind strings; layout positions are
included so a load restores the schematic exactly.

---

## 10. Project structure

```
/workspace
├── README.md               # user-facing doc
├── PLAN.md                 # this roadmap
├── docs/ARCHITECTURE.md    # as-built design summary
├── apps/
│   └── logica/src/
│       ├── editor/     geometry.ts, renderer.ts, routing.ts, palette.ts, Canvas.tsx
│       ├── state/      editorStore.ts, uiStore.ts
│       ├── ui/         App.tsx, Toolbar.tsx, Sidebar.tsx, LibraryPanel.tsx,
│       │               ResizeHandle.tsx, GroupDialog.tsx
│       ├── main.tsx
│       └── index.css
├── packages/
│   └── model/src/      types.ts, primitives.ts, group.ts, index.ts
│       └── test/       primitives.test.ts, group.test.ts
└── (planned) sim/       engine.ts, events.ts, clock.ts, flatten.ts
```

---

## 11. Roadmap

| # | Phase | Status |
|---|-------|--------|
| 1 | Scaffold — pnpm monorepo, Vite + React + TS, Zustand/immer, Vitest, base layout | ✅ done |
| 2 | Data model — types + primitives + `ports: Port[]`/`PinRef` migration (done); JSON serialize/validate | ⏳ in progress |
| 3 | Simulation core — combinational → clocked/sequential → hierarchy flattening + cycle detection | ⏳ pending |
| 4 | Canvas editor — render, pan/zoom, drag/marquee/group-move (done); wire drawing | ⏳ in progress |
| 5 | Component model UX — descend/ascend, group into composite, ports editor, instance rename | ✅ done |
| 6 | Simulation UI — run/step, clock source, live signal coloring | ⏳ pending |
| 7 | Save/load — JSON import/export, file download/upload | ⏳ pending |
| 8 | Refinements — bezier wires, port terminals, theming, tooltips (done); buses, more primitives, truth-table view, undo/redo | ⏳ pending |
