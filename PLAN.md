# Logica — Implementation Plan

A graphical designer and simulator for logic circuitry. Runs in the browser, built on
TypeScript, React, and Zustand. Circuits are composed of components (gates, clock
sources, and user-defined sub-circuits) wired together and simulated with sequential
(clocked) behavior.

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

- **Vite + React 18 + TypeScript** (strict mode).
- **Zustand** (state management) + **immer** (immutable updates) + **zundo** (undo/redo).
- **HTML5 `<canvas>`** for the schematic editor, backed by a retained scene-graph model with
  manual hit-testing.
- **Vitest** for unit tests (simulator and data model are the correctness-critical parts).
- No backend. Designs are JSON files on disk.

---

## 3. Core data model (`src/model`)

The model cleanly separates **definitions** (types) from **instances** (usages).

```ts
type Signal = 0 | 1 | 'x'; // 3-state logic (0, 1, unknown)

type Port = { id: string; name: string; direction: 'input' | 'output' };

type PrimitiveKind = 'and' | 'or' | 'xor' | 'not' | 'clock';

interface ComponentDef {
  id: string;
  name: string;                 // unique within its scope
  kind: 'primitive' | 'composite';
  primitive?: PrimitiveKind;    // present when kind === 'primitive'
  inputs: number;               // number of input ports (AND/OR/XOR default 2, NOT = 1, CLOCK = 0)
  outputs: number;              // number of output ports (gates/CLOCK = 1)
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

interface Connection {
  id: string;
  from: { instanceId: string; portId: string }; // output pin, or a top-level input
  to:   { instanceId: string; portId: string }; // input pin, or a top-level output
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

### Port conventions

- Ports are implicitly indexed: inputs `0..n-1` are rendered on the **left** edge of the
  component, outputs `0..m-1` on the **right** edge (see §6).

---

## 4. Component library

The palette of primitives, initially:

- **AND** (default 2 inputs, 1 output)
- **OR** (default 2 inputs, 1 output)
- **XOR** (default 2 inputs, 1 output)
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

### Wires

- **Straight lines** for the MVP.
- Later we will switch to **cubic-bezier curves**. A routing abstraction layer isolates this
  change so it stays local.

### Interactions

- **Click + drag on a component** → move the component (update `Instance.pos`).
- **Click + drag on the background** → pan the viewport.
- **Mouse wheel** → zoom in/out (anchored at the cursor).
- **Drag from an output pin to an input pin** → create a wire.
- Select, delete, and otherwise manipulate wires and components.
- During simulation, wires/pins are colored live by their signal value (`0`/`1`/`X`).

### Panels

- **Sidebar (left):**
  - Component tree (composite → instances → ports).
  - Click selects; **double-click a composite instance descends** into its definition;
    a breadcrumb trail ascends back up.
  - **Properties panel** shows/edits: name, port count, primitive kind, clock period, etc.
- **Library panel:** palette to pick a component to place.
- **Toolbar:** run/stop/step simulation, save/load JSON, zoom controls.

---

## 7. State management (`src/state`)

Zustand stores, split by concern:

- `designStore` — the `Design` document (definitions, instances, connections) via immer,
  wrapped in zundo for undo/redo.
- `editorStore` — active tool (select/wire/place), selection, viewport (pan/zoom).
- `simStore` — running/paused, simulated time, current pin values, clock state.
- `uiStore` — sidebar selection/navigation path, panel visibility.

---

## 8. JSON file format

The `Design` object is serialized verbatim, with a schema `version` field for future
migration. Primitive definitions are referenced by stable kind strings; layout positions are
included so a load restores the schematic exactly.

---

## 9. Project structure

```
logica/
  src/
    model/      types.ts, primitives.ts, serialize.ts, validate.ts
    sim/        engine.ts, events.ts, clock.ts, flatten.ts
    state/      designStore.ts, editorStore.ts, simStore.ts, uiStore.ts
    editor/     scene.ts, renderer.ts, interactions.ts, routing.ts
    ui/         App.tsx, Canvas.tsx, Sidebar.tsx, PropertiesPanel.tsx, LibraryPanel.tsx, Toolbar.tsx
    util/       id.ts, math.ts
  tests/        sim/*.test.ts, model/*.test.ts
```

---

## 10. Roadmap

1. **Scaffold** — Vite + React + TS, Zustand/immer/zundo, Vitest, base layout
   (canvas + sidebar + toolbar).
2. **Data model** — types, primitives, JSON serialize/deserialize + validation, unit tests.
3. **Simulation core** — combinational engine first, then clocked/sequential + hierarchy
   flattening + cycle detection; thorough unit tests.
4. **Canvas editor** — render gates/wires, pan/zoom, place/drag/select, wire drawing.
5. **Component model UX** — create composite, define ports, descend/ascend navigation,
   properties panel.
6. **Simulation UI** — run/step, clock source, live signal coloring.
7. **Save/load** — JSON import/export, file download/upload.
8. **Refinements** — cubic-bezier wires, multi-bit buses, more primitives (JK flip-flop,
   latch, counter, etc.), truth-table view, nicer gate shapes.
