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
- **Zustand** (state management) + **immer** (immutable updates) + **zundo** (undo/redo).
- **HTML5 `<canvas>`** for the schematic editor, backed by a retained scene-graph model with
  manual hit-testing.
- **Vitest** for unit tests (simulator and data model are the correctness-critical parts).
- No backend. Designs are JSON files on disk.

---

## 3. Core data model (`@logica/model`)

The model cleanly separates **definitions** (types) from **instances** (usages).

```ts
type Signal = 0 | 1 | 'x'; // 3-state logic (0, 1, unknown)

interface Port {
  id: string;
  name: string;
  direction: 'input' | 'output';
  terminal?: { instanceId: string; pinId: string }; // composite only: internal port instance
}

type PrimitiveKind = 'and' | 'or' | 'xor' | 'not' | 'clock' | 'fan-in' | 'fan-out' | 'input-port' | 'output-port';

interface ComponentDef {
  id: string;
  name: string;                 // unique within its scope
  kind: 'primitive' | 'composite';
  primitive?: PrimitiveKind;    // present when kind === 'primitive'
  ports: Port[];                // ordered: inputs first (in:0..n-1), then outputs (out:0..m-1)
  // Composite internals:
  instances?: Instance[];       // sub-components (including port instances)
  connections?: Connection[];   // netlist wiring internal pins
}

interface Instance {
  id: string;
  name: string;                 // unique within the parent composite's scope
  defId: string;                // reference into Design.defs
  pos: { x: number; y: number }; // canvas placement
}

// A connection endpoint is always an instance pin.
type PinRef = { instanceId: string; portId: string };

interface Connection {
  id: string;
  from: PinRef;                 // driver (an output pin)
  to: PinRef;                   // sink (an input pin)
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
- **Ports are modeled as port-group instances**: a single `input-port` instance carries
  all of a composite's inputs (its pins are derived from `ports`, acting as drivers) and a
  single `output-port` instance carries its outputs (acting as sinks). This keeps all
  internal wiring plain output→input and the source/sink role unambiguous. The group is
  rendered as a rectangle (green terminals for inputs, blue for outputs) and is movable as
  one unit.
- **Single-driver invariant**: each sink (`to`) has at most one incoming connection;
  fan-out from a driver (`from`) is unrestricted.

---

## 4. Component library

The palette of primitives, initially:

- **AND** (2 inputs, 1 output)
- **OR** (2 inputs, 1 output)
- **XOR** (2 inputs, 1 output)
- **NOT** (1 input, 1 output)
- **CLOCK** (0 inputs, 1 output)
- **FAN-IN** (n inputs, 1 bus output — bundles n single wires into a bus)
- **FAN-OUT** (1 bus input, n outputs — splits a bus into n single wires)

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
- **Press an output pin** → draw a wire to an input pin (drop to connect; a dashed preview
  follows the cursor).
- **Press an input pin that already has a wire** → grab it: release on a new input to
  re-target, or on empty space to delete. Dropping onto an already-driven input is rejected.
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
- **Toolbar:** group action, simulation controls (run/step/stop/reset), save/load JSON,
  theme toggle.
- **Shortcuts:** Ctrl/Cmd+C copy · Ctrl/Cmd+V paste · Delete/Backspace delete ·
  Ctrl/Cmd+Z undo · Ctrl/Cmd+Shift+Z (or Ctrl/Cmd+Y) redo.

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
   - outputs = distinct selected output pins feeding outside;
   - plus *exposed* ports: unconnected selected inputs → input terminals, and unconnected
     selected outputs → output terminals (wired only internally, so floating inputs can be
     driven and unused outputs used later).
5. Show a **review dialog** listing the inferred inputs/outputs with editable names
   (auto-names `in1`, `out1`). Confirm to create.
6. `applyGroup` then:
   - creates the new `ComponentDef` (unique name, inferred `ports`, moved `instances`
     kept at their current positions, and internal connections);
    - for each direction with inferred ports, creates a single `input-port`/`output-port`
      **group instance** (linked via `Port.terminal`) and wires the moved pins through it
      (exposed ports get only this internal wiring);
    - removes the selected instances and all touching connections from the parent;
   - inserts a single instance of the new def at the bounding-box center;
   - re-adds external connections to that instance's ports (auto-rewire).
7. The new component appears in the Library's "My components" list.

### Editing later

- The composite's ports remain fully editable: add/remove/rename via the **ports editor**.
  Adding/removing a port adds/removes a pin on the corresponding port group.
- Port groups are movable as a whole (drag the rectangle body); their pins use the normal
  output→input wire flow (implemented).

### Deferred

- Cycle detection for nested composites, name-uniqueness validation.

---

## 8. State management (`src/state`)

Zustand stores, split by concern:

- `editorStore` — the `Design` document (definitions, instances, connections) via immer and
  zundo, plus viewport, multi-selection, marquee, wire/hover/notice state, clipboard, and
  navigation stack.
- `uiStore` — theme, panel widths, and other persisted UI preferences.
- `simStore` — (planned) running/paused, simulated time, current pin values, clock state.

---

## 9. JSON file format

The `Design` object is serialized verbatim, with a schema `version` field for future
migration. Primitive definitions are referenced by stable kind strings; layout positions are
included so a load restores the schematic exactly. A saved design is self-contained.

A separate **library file** (`{ version, components: ComponentDef[] }`) holds the custom
component library: the template composites plus their transitive composite closure, with
primitive references normalized to built-in ids.

---

## 10. Project structure

```
/workspace
├── README.md               # user-facing doc
├── PLAN.md                 # this roadmap
├── docs/                   # ARCHITECTURE.md, NOTES.md, GLOSSARY.md
├── apps/
│   └── logica/src/
│       ├── editor/     geometry.ts, renderer.ts, routing.ts, palette.ts,
│       │               canvasVector.ts, Canvas.tsx
│       ├── state/      editorStore.ts, uiStore.ts
│       ├── ui/         App.tsx, Toolbar.tsx, Sidebar.tsx, LibraryPanel.tsx,
│       │               ResizeHandle.tsx, GroupDialog.tsx, SortablePortList.tsx, Toast.tsx
│       ├── main.tsx
│       └── index.css
├── packages/
│   └── model/src/
│       ├── types.ts, group.ts, clipboard.ts, serialize.ts, library.ts, index.ts
│       ├── primitives/   vector.ts, primitive.ts, gate.ts, and.ts, or.ts, xor.ts,
│       │                 not.ts, clock.ts, fan-in.ts, fan-out.ts,
│       │                 input-port.ts, output-port.ts, index.ts
│       └── test/       primitives.test.ts, connections.test.ts, group.test.ts,
│                       clipboard.test.ts, serialize.test.ts, library.test.ts
└── (planned) sim/       engine.ts, events.ts, clock.ts, flatten.ts
```

---

## 11. Roadmap

| # | Phase | Status |
|---|-------|--------|
| 1 | Scaffold — pnpm monorepo, Vite + React + TS, Zustand/immer, Vitest, base layout | ✅ done |
| 2 | Data model — types + primitives + `ports: Port[]` + port components; JSON serialize/validate | ✅ done |
| 3 | Simulation core — combinational → clocked/sequential → hierarchy flattening + cycle detection | ⏳ pending |
| 4 | Canvas editor — render, pan/zoom, drag/marquee/group-move, wire create/grab/re-target, library placement, copy/paste/delete, undo/redo | ✅ done |
| 5 | Component model UX — descend/ascend into any component, group into composite, ports editor, instance rename | ✅ done |
| 6 | Simulation UI — run/step, clock source, live signal coloring | ⏳ pending |
| 7 | Save/load — JSON import/export, file download/upload (done); component library export/import (done) | ✅ done |
| 8 | Refinements — bezier wires, port components, copy-on-place variants, arity constraints, animated port reorder, theming, tooltips (done); buses (fan-in/fan-out, derived bus width) (done); truth-table view | ⏳ pending |
