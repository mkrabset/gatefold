# Session Notes

Last updated: 2026-08-28 (default program state in localStorage — save/clear toolbar buttons + auto-init on launch; auto-fit/center the canvas on load).

## Where we are

Gatefold is a graphical logic-circuit designer/simulator (TypeScript + React + Zustand +
HTML5 canvas, pnpm monorepo). The editor is feature-complete for building/editing
hierarchical circuits, with JSON save/load and library export/import, **and a working
event-driven simulator** (combinational + gate-built latches/flip-flops, buses, probe
components, signal-colored wires). See `PLAN.md` (roadmap), `docs/ARCHITECTURE.md`
(as-built design), `docs/GLOSSARY.md` (terminology).

## Latest (this session)

- **Default program state in `localStorage`** — two new toolbar buttons (next to Save JSON /
  Export Verilog): **Save as default** (bookmark icon) stores the current design under the
  `localStorage` key `gatefold-default-design`; **Clear default** (trash icon) removes it. On
  launch the editor initializes from that stored state when present, giving an automatic start
  state. New module `apps/gatefold/src/state/defaultState.ts`:
  - `DEFAULT_STATE_KEY`, `readDefaultState()` / `saveDefaultState(design)` /
    `clearDefaultState()`, all guarded for environments without `localStorage`.
  - `repairDesign(json)` — the shared parse/repair pipeline (parse → `withBuiltinPrimitives` →
    `sanitizeDesign` → lineage-`uuid` backfill → `unreachableDefIds` GC). Now used by both the
    launch-default restore and `loadProject`, deduplicating the parse/sanitize/migrate logic
    that was previously inlined in `loadProject`.
  - `editorStore` gains `saveDefault`/`clearDefault` actions (with toast notices) and
    initializes `design: readDefaultState() ?? createDemoDesign()`.
  - Tests: `apps/gatefold/src/state/defaultState.test.ts` (round-trip, clear, malformed JSON,
    non-design JSON, uuid backfill/orphan GC, and the store actions).
- **Auto-fit on load** — after **Open JSON** and after restoring the launch default, the canvas
  centers and zooms the root sheet to fit the viewport, reusing the enter-component
  `defContentsBounds` + `fitViewport` path. The store holds a `fitToken` counter (incremented in
  `loadProject`; seeded `1` when a launch default is restored) so the canvas can perform a
  one-shot fit without the store needing canvas dimensions. A new `useEffect` in `Canvas.tsx`
  watches `fitToken` (tracking the last handled value in a ref) and fits exactly once per load;
  empty designs keep the default `{x:400, y:250, zoom:1}` viewport.

## Simulation (previous session)

- **`@gatefold/sim` package** — a pure, framework-free engine (`packages/sim`) that depends
  only on `@gatefold/model`. Never mutates the `Design`; holds a flattened netlist + signal
  state.
- **`Primitive.transfer(inputs: Signal[][]): Signal[][]`** — pure 3-state (`0`/`1`/`x`)
  combinational logic per primitive (the previously-reserved slot). `x` propagates; `0`
  dominates AND, `1` dominates OR. Sources (CLOCK/SWITCH-ARRAY) and sinks (LED-ARRAY/7-SEG)
  return `[]`; the engine drives/reads them. `Port.inverted` is applied by the engine at pin
  boundaries (NOT = buffer + inverted output).
- **Flattening** (`netlist.ts`) — dissolves the hierarchy through `Port.terminal` into leaf
  primitive instances + nets (union-find); port groups and composite boundaries are unioned
  into the same net. Returns `instances`, `netWidths`, `driven`, and a **`pinNet`** map so
  signals can be looked up for *any* pin (leaf, port-group, or composite boundary).
- **Event-driven evaluation + inertial delays** (`engine.ts`) — a min-heap of timed events;
  an input change schedules the gate's output at `now + delay` (versioned events supersede
  pending outputs → inertial). Configurable `defaultDelay` + per-kind overrides (ps).
- **Power-on resolution** — driven nets initialize to `0` (floating stay `x`), then a
  zero-delay **Gauss-Seidel** pass settles feedback loops to a valid stable state; true
  oscillators are detected (per-net change count) and frozen at `x`. This breaks the `x`
  deadlock in gated feedback (e.g. a JK's set/reset gated by its own outputs).
- **Clock & step** — CLOCK `period` (ps, now `10 000` default) drives a square wave via
  `advanceTo(t)`; `step()` is `'quiescent'` (settle) or `'clock-edge'` (advance one edge),
  per `SimConfig.stepMode`.
- **Probe primitives** — `switch-array` (multi-lane toggle source), `led-array` (multi-lane
  lamp sink), `seven-seg` (multi-digit display sink) added to the model registry/library; the
  sim renderer lights them live. The single-lane `switch` and `led` primitives were later
  removed (the array versions supersede them).
- **`switch-array` / `led-array`** — array versions of switch/led with a `terminalType`
  property (`wire` | `bus`).
  - WIRE: one single-wire terminal per lane (default 1, addable/removable via the ports
    editor; the port list is the source of truth — the store regenerates the instance's
    variant-def ports and prunes orphaned connections).
  - BUS: one port whose width is **neutral** (intrinsic `null`), adopting the connected bus
    width; the body shows a **`?` box** while undetermined.
  - `PropertySpec` gained a `'select'` type (used by `terminalType`); the sim engine's source
    state is a per-instance **lane vector** (`toggleSwitch(id, lane)`), so individual output
    terminals (WIRE) or bus lanes (BUS) toggle independently.
- **Sim UI** (`apps/gatefold/src/state/simStore.ts` + `editor/renderer.ts` + `ui/SimSettingsDialog.tsx`)
  — design/simulate mode toggle; Run/Step/Stop/Reset; switch toggling; signal-colored wires
  (red=`1`, black=`0`, gray=`x`) and single-wire markers; a settings dialog (gate delay ps,
  step mode). In simulate mode editing is disabled but navigation still works (instance-path
  `descend`/`ascend` parallel to `navStack`).
- **Tests** — `packages/sim/test/engine.test.ts` covers gates, `x` propagation, SR latch,
  gated JK, **master-slave JK edge-triggering**, oscillator → `x`, buses, clock, clock-edge
  stepping, and port-group/composite signal resolution.

## Latest (previous session)

- **Refactoring pass — code deduplication** (no behavior changes; `typecheck`/`test`/`lint`
  all green):
  - `isTemplateDef(design, def)` extracted to `@gatefold/model` (`types.ts`); replaces six
    hand-rolled `kind === 'composite' && variant !== true && id !== root` predicates in
    `editorStore` (incl. `renameDef`), `Canvas`, `Sidebar` (×2), `Toolbar`, and
    `LibraryPanel`. The stricter predicate also stops a primitive def in the breadcrumb
    from showing a spurious "template" badge.
  - `copyDefIntoDesign(design, defId)` (store-local) consolidates the three identical
    copy-on-place blocks (promote, confirmGroup, addInstance).
  - `CLOCK_DEFAULT_PERIOD` constant exported from `primitives/clock.ts`; `engine.ts` uses
    it in place of two hardcoded `10_000` fallbacks.
  - `instancesReferencing(design, defId)` added to `types.ts`; `isDefReferenced`,
    `findArrayRef`, and `pruneConnectionsToPorts` now share the one graph walk.
  - `INSTANCE_PATH_SEP` + `joinInstancePath` exported from `@gatefold/sim`; shared by
    `netlist.ts` and `simStore.flatId` (single `.`-path convention, no desync).
- **Renamed the array probes** — the `switch-array` primitive's label is now `SWITCHES` and
  the `led-array`'s is `LEDS` (the internal kinds are unchanged). Both now default to a single
  **`bus`** terminal (`terminalType` default `wire` → `bus`; `defaultPorts()` return the bus
  port), and the store's `?? 'wire'` fallbacks became `?? 'bus'`. Tests updated accordingly.
- **Renamed the project to "Gatefold"** — directory `apps/logica` → `apps/gatefold`, package
  scope `@logica/*` → `@gatefold/*`, brand strings (`index.html` title, toolbar brand-name and
  its `L`→`G` mark), the `localStorage` key (`gatefold-ui`), download names
  (`design.gatefold.json` / `library.gatefold.json`), the drag MIME type
  (`application/x-gatefold-def`), error strings, and all docs; the example `.logica.json` files
  were renamed. `pnpm install` re-linked the workspace; typecheck/test/build all green.
- **Sim-mode UX**:
  - The canvas background turns **dark green** while simulating (`Palette.simBg` in both
    palettes; `renderer.ts` selects it in sim mode).
  - **Run** now enters simulate mode from design mode and starts running (extracted
    `enterSim()`; `toggleMode` reuses it).
  - **Space** toggles run/pause in simulate mode (global keydown in `App.tsx`).
  - **Escape** at the top level in simulate mode leaves simulate mode (deeper, it ascends).
- **Library panel** — grid switched to `repeat(auto-fill, minmax(92px, 1fr))`, default width
  180→260 and min 140→220, and labels ellipsize, so no component button is pushed off-screen.
- **Library export fix** — `exportLibrary` no longer exports `variant` copies: references to a
  template's variant copies are collapsed back to the template via the shared lineage `uuid`,
  so a component containing other components exports only the library templates (an orphaned
  variant with no matching template is promoted so the file stays self-contained).
  `library.test.ts` covers collapse + promotion.
- **Sim-mode hardening (template isolation)**:
  - Library cards are not draggable in simulate mode (`LibraryPanel` `draggable={!simulating}`;
    `Canvas` `handleDragOver`/`handleDrop` guard).
  - Entering a template while simulating is disabled (`LibraryPanel`/`Sidebar` gate), and
    `simStore` gained a `viewingLive()` guard so `rawSignalOf` (and `simColorOf`/`simValueOf`/
    `simSignalOf`) plus `toggleSwitch` only act on the live def at the current `path`. Fixes
    template internals flashing live signal colors from a sibling instance (the `navStack`/`path`
    desync + instance-id collision).
- **`DFF` primitive (sequential)** — new `dff` primitive (`D`/`CLK`/`RST` → `Q`) with properties
  `edge` (`posedge`/`negedge`), `initialValue`, and `resetActiveHigh`. The engine gained a
  **sequential path**: `Primitive.isSequential()` / `clockPortId()` / `resetPortId()`, a
  `Sequential` per instance wired into `seqFanout` on the CLK and RST nets, and
  `evaluateSequential` (edge-triggered sample of D with clk-to-q delay; async reset forces Q to
  `initialValue`, overriding the clock). Q powers on to `initialValue`; `lastClk` seeds from the
  settled clock. This is the register model the future Verilog exporter maps 1:1 to
  `always @(posedge clk) …`, so sequential designs export as real FPGA flops rather than gate
  feedback. Tests: model (library/ports/props/`isSequential`) + engine (posedge/negedge, async
  reset active-high/low, `initialValue`, shift register, DFF-in-composite).
- **DFF terminal labels** — the DFF's terminals have distinct purposes, so it opts into
  `Primitive.showTerminalNames()`, and the renderer's `drawTerminalLabels` draws each port name
  inside the body next to its pin (`D`/`CLK`/`RST` on the left, `Q` on the right). Other
  primitives keep their unlabeled pins.
- **Source/sink inversion fix** — inversion bubbles previously had no effect on sources/sinks
  (the engine only applied `Port.inverted` for combinational gates). Now `driveSource`/source-init
  invert a source's output net (`out.inverted`), and the renderer applies input inversion to sink
  displays (LED/7-seg) while un-inverting the switch circle so it still shows the toggle state.
  Added `invertSignal` (3-state NOT) to the model's `logic.ts`. Tests: engine (inverted switch
  output) + model (`invertSignal`).
- **Inversion bubbles 20% larger** — `drawPin` bubble radius is now
  `pinRadiusWorld(1) * zoom * 1.2`.
- **Verilog export (`@gatefold/verilog`)** — new `packages/verilog` package: `exportVerilog(json)`
  turns the serialized design into a synthesizable `.v` module hierarchy (input = the save-JSON
  format, output = Verilog, so the generator is fully decoupled from the app). One `module` per
  composite (root = top), gates as `assign` (inversion = `~`), the DFF as
  `always @(posedge clk …)` with async reset + `INIT`, buses as `[n-1:0]` concat/slice, child
  composites as instantiations, and probes as top-level I/O (CLOCK/SWITCHES → `input`, LEDS/7-SEG →
  `output`). A nested switch is emitted as a constant at its `initialValue`. Identifier
  sanitization/keyword avoidance/dedup. Exposed as: a `tsx` CLI
  (`pnpm --filter @gatefold/verilog cli <in.json> [out.v]`), a toolbar **Export Verilog** button
  (downloads `design.v`), and `packages/verilog/test/verilog.test.ts` (9 tests). `pnpm-workspace.yaml`
  gained `allowBuilds: { esbuild: true }` for `tsx`.
- **Verilog issue severity** — `exportVerilog` returns `issues: { level: 'info' | 'error'; message }[]`.
  Errors (toast + console): floating nets, nested clocks, dangling refs. Info (console only): nested
  switches (fixed initial value) and nested sinks (not exported).
- **Event-driven clock (run aliasing fix)** — the clock is no longer a continuous source sampled at
  `advanceTo` checkpoints; each clock keeps **one pending edge event** that toggles its net and
  schedules the next edge at `now + half`. `advanceTo(t)` now advances *through* all events `≤ t`
  (time-bounded, via a `drainEvents(shouldProcess)` + `MinHeap.peek()`), and `settle()` stops at the
  next clock edge. This eliminates the `1000 ps`-tick aliasing for short clock periods and makes
  `run()` advance to the next clock edge (`engine.nextClockEdgeDelta()`, exposed) with a `RUN_STEP`
  fallback for clockless designs; `run()` then calls `engine.settle()` (made public) so pausing never
  leaves a mid-cascade state. Tests: intermediate-edge advancing + a DFF on a `1000 ps` clock
  (engine tests).
- **Timing-breach lamps (single clock)** — the engine now latches a **half-period** breach
  (`timingHalfViolation`) when a gate output settles later than its triggering clock edge + `half`,
  and a **full-period** breach (`timingFullViolation`) when later than `edge + period`. Gate events
  carry the triggering edge (`Event.edge`), propagated through the cascade and reset on clock edges /
  manual source toggles. Exposed via `hasSingleClock()` / `resetTiming()` (run resets the lamps).
  The toolbar shows a green/yellow/red **lamp** (with tooltips) whenever there is exactly one clock.
  Tests: no-breach / half / full chains of buffers, zero/multiple clocks, `resetTiming`.

## Earlier (previous session)

- **Removed `switch` and `led` primitives** — superseded by `switch-array`/`led-array`. Their
  kinds were dropped from `PrimitiveKind`/`LIBRARY_KINDS` and the `switch.ts`/`led.ts` classes
  deleted; the sim engine's per-lane `toggleSwitch(id, lane)` and the array body renderer are
  the only remaining switch/led handling.
- **Arrays default to one wire terminal** — `switch-array`/`led-array` now default to a single
  WIRE terminal. The redundant `size` property was removed; the port list is the source of
  truth, edited via the ports editor's +/−.
- **`BUS` primitive** — a bus passthrough (single bus in + single bus out) whose `lanes`
  property (default 8, 1–32) *fixes* the width of both terminals. Added `Primitive.widthError`
  and made the width solver apply per-primitive width constraints after the fixpoint, surfacing
  the message through `connectionError`. `Primitive.intrinsicWidth` now takes the instance
  `props` (for property-driven widths).
- **Multi-digit `seven-seg`** — the 4 single-wire inputs are now a single **neutral bus input**
  (width divisible by 4, ≤ 64, enforced via `widthError`), rendering one digit per 4-bit
  nibble, MSD leftmost. New `order` property (`asc`/`desc`, default `asc`) selects which end of
  the bus is the LSB. Rendering lives in `renderer.ts` (`drawSevenSegBody`) and scales with
  zoom (stroke width `6·zoom`; `sevenSegGeometry` insets scale with the box).
- **Array rendering & interaction** (`switch-array`/`led-array`):
  - Indicators scale with zoom (removed the fixed `18px` cell cap; cell height = body/`n`).
  - Padding — half an indicator's slot added at the top and bottom (clamped so neighbours
    never collapse at size 1–2).
  - Each indicator is positioned at the exact screen y of its terminal (WIRE) or bus lane
    (BUS) via `arrayIndicatorLanes` (shared world-space geometry in `geometry.ts`).
  - Sim mode toggles a lane by clicking its indicator circle (`hitArrayIndicator`), not the
    terminal marker; double-clicking a circle toggles twice and does **not** enter the array.
- **Fit-to-view on enter + restore on escape** — double-clicking into a component now frames
  its internals: `defContentsBounds` (union of instance bounds) + `fitViewport` set the
  viewport to the fitted view. A `viewportStack` (parallel to `navStack`) saves the outer
  transform on `navigateTo` and restores it on `navigateUp` (Escape / ↑), so exiting returns
  you to the exact view you left. `loadProject` and entering simulate mode reset the stack.
- **7-seg visual pass** — the display got a **green body with a border** (`#0d2818` fill,
  `#3fb950` border), and the segments became **pointed hexagons** that "lock" together with a
  thin gap (filled polygons from `sevenSegGeometry`, not stroked lines). Unlit segments are a
  faint green (barely lighter than the body); lit segments are a bright amber (`#fcd34d`).
- **CLOCK glyph** — now a **square wave** instead of a sine; the phase was shifted so it starts
  at mid and rises (sine-like, not cosine-like). Every metric (corner radius, stroke, amplitude,
  padding) scales with `screenH / worldH`, so the glyph is zoom-invariant.
- **Empty starting design** — `createDemoDesign` no longer ships a half-adder or any demo
  components: it builds only the built-in primitive defs and an empty `main` sheet. Removed the
  now-unused `variantize`/`iref` helpers; the store tests got their own `makeTestDesign`
  fixture.
- **Library scroll** — the "My components" grid now scrolls independently (`.library` is a flex
  column, `.lib-components` is the `overflow-y: auto` region) instead of the whole panel.
- **Documentation** — README rewritten as an overview; new `docs/USER_GUIDE.md` (UI tour,
  canvas + shortcuts, building, buses, a reference section per primitive, and a simulation
  chapter).
- **Deduplication / relocation pass** — a sweep for duplicate code and misplaced logic:
  - Model: `ArrayPrimitive` base extracted (dedupes `switch-array`/`led-array`); the 7-seg
    pattern table moved out of the renderer into `sevenSegDigit(bits)`; `resolvedPinWidth`
    added to `widths.ts` (the `isNeutralPin ? null : pinWidth` pattern); dropped the three
    `nextId` wrappers (call `uniqueId` with the right separator directly).
  - App: `arrayLaneCount`/`sevenSegLaneCount`/`portArity` now share `resolvedPinWidth`;
    renderer gained `drawRoundedBox`/`drawUndetermined`/`strokeDashedRect`; `simStore`
    gained `rawSignalOf`; a new `editor/viewport.ts` (`w2s`/`s2w`) replaces the renderer's
    `w2s` + Canvas's inline `toWorld`; `Sidebar` merged `NameField`/`DefNameField` into
    `CommitName`; `downloadText` moved to `util/download.ts`.
- **Attribution** — a small "(C) Marius Krabset 2026" now sits in the toolbar's top-right.
- **Apply-to-instances ignores port names** — `portsMatch` now compares only the ordered port
  **ids** (plus arity); names are ignored during matching and overwritten from the template on
  apply, so renaming a template's ports bulk-updates its instances.
- **Instance names are no longer auto-suffixed** — placing (drag from the library) and
  copy/paste keep the source's name verbatim (`addInstance` → `srcDef.name`, `instantiateClipboard`
  → `inst.name`); the instance `id` stays uniquified (that's what logic keys on), so duplicate
  names are possible and harmless.
- **Sidebar properties rework** — the current scope's **Ports** editor now sits at the top with a
  divider line; the selected component's properties dropped the X/Y and Inputs/Outputs-count
  fields and gained an inline terminal editor (add/remove/rename/reorder/invert) via `PortsGroups`.
  The port actions are now `defId`-parameterized, and `removePort` prunes the parent sheet's
  wires to a removed terminal (`pruneConnectionsToPorts`).
- **Relative asset links** — Vite `base: './'`, so the production build is portable.
- **AsciiDoc user guide** — added `docs/USER_GUIDE.adoc` (auto TOC, admonition for the internal
  primitives note) alongside the Markdown version.
- **7-seg `mode` property** — the display now decodes its bus as **HEX**, **DEC** (unsigned
  decimal), or **SIGNED DEC** (two's-complement, with a leading `−` sign slot). New model
  helpers `sevenSegPositionCount` (slot count from width + mode, using BigInt-safe digit math)
  and `sevenSegDigits` (segment masks per slot, blank leading slots); geometry/renderer compute
  the body width and glyphs from these.
- **Collapsible component tree** — the sidebar's "Components" title gained a show/hide toggle
  (`−`/`+`), so a long component tree no longer squeezes the Ports/Properties sections.
- **Def garbage collection** — added `unreachableDefIds` (model `util.ts`) and a store
  `pruneOrphanedDefs` that removes orphaned `variant` defs (unreachable from the root, library
  templates, or built-ins). Runs after `deleteSelection`, `confirmDeleteTemplate`,
  `applyTemplateToInstances`, and `loadProject` — so deleting a component frees its name and
  keeps saves lean.
- **Template rename collision check** — `renameDef` now rejects (with a toast) renaming a
  template to a name already used by any def (template, variant, built-in, or root).
- **Switch-array initial value** — the switch-array gained an `initialValue` (boolean, default
  off) property. Every lane powers on to that value when simulation starts (the engine's
  `defaultLanes` feeds `sourceValues`/`setLane`/`laneValue`), and the renderer colors the circles
  on in design mode when it is true.

## Earlier (kept as historical log)

- **Lineage `uuid`** — `ComponentDef.uuid?: string` tracks a component's *origin*. A template
  and every variant copied from it share the same `uuid`; def identity stays `id`.
  `newUuid()` (model `util.ts`) generates it. Assigned in `applyGroup`, `importLibrary`, the
  demo design, and on `loadProject` (migration for older saves). `cloneDef`/`copyDefSubgraph`
  preserve it (variants inherit), so `addInstance`/paste/group all link variants to their
  template automatically.
- **Apply template to matching instances** — new `apps/gatefold/src/editor/apply.ts`:
  `scopeDefIds` (current def + transitive nested defs), `portsMatch` (same lineage `uuid`,
  `variant`, and unaltered ordered port ids; arity equal or either neutral; `inverted` and
  port **names** are ignored), and `applyTemplate` (re-instantiates a variant's internals from
  the template, preserving its port ids + `inverted` and external wiring, and overwriting port
  names with the template's — so renaming a template bulk-updates instances). Store action
  `applyTemplateToInstances` sets a notice and is undoable; the library panel shows an
  "Apply to instances" button when a template card is selected.
- **Inversion is instance-level** — templates keep clean (non-inverted) terminals.
  `applyGroup` no longer writes `inverted` onto template ports; `confirmGroup` applies the
  inherited inversion to the *instance variant* instead; promote ("Save as template") gets a
  fresh `uuid` + stripped inversion (independent — no shared uuid with the original).
  `setPortInverted`/`togglePinInversion` and the ports-editor checkbox are disabled on
  templates; variants and primitives (NOT/BUFFER) still invert freely.
- **Linear terminal markers + constant-gap stacking** — `pinRadiusWorld` is now `3.5·width`
  (linear, so each bus lane keeps a constant pitch). Terminal placement no longer spreads by
  the largest radius: each side's markers are **stacked** with a constant `TERMINAL_GAP` gap
  and `SIDE_PADDING` at top/bottom (`sideHeight`/`sidePinOffset` in `geometry.ts`); the body
  height is `max(base, input side, output side)`. Removed `neededHeight`/`distributedY`/
  `maxPinRadius`/`portGroupSize`.
- **Individual bus wires** — buses render as `n` single-wire beziers spread across the pin
  marker (`busWireOffsets`, inset one lane from each end), instead of one thick wire. Control
  points translate with each lane's endpoint (same horizontal offset as a single wire).
- **Per-lane inversion bubbles** — an inverted bus terminal now draws a small bubble at the
  end of each individual wire (one per lane, single-wire sized) instead of one huge bubble;
  inverted/non-inverted label clearance is now a constant (no longer scales with width).
- **Code-deduplication pass** — shared `pinKey`, `uniqueId`, `remapInstanceDefs`,
  `collectClosure` (model `util.ts`/`types.ts`); `isPortGroupDef` reused in the store;
  `portGroupInstPredicate` hoisted in `group.ts`. Primitives refactored: `PortGroup` base
  (`input-port`/`output-port`), `twoInputGatePorts`/`twoInputGateBody`, `gateBounds`/
  `fillAndStroke`, `drawBusTrapezoidLeft/Right`, `deriveBusWidth`. React: shared `CommitInput`;
  `GLYPHS` replaced with `primitiveOf(kind).glyph`.
- **Terminal hover highlight** — the hover "red circle" overlay is gone; instead the terminal
  marker itself turns red (`p.pinHighlight`) when hovered. Hit-testing (`hitTestPort`) now
  tests the whole marker (distance to the vertical segment, half-height `pinRadiusWorld(width)`),
  so bus markers are hittable along their full length. Unconnected inputs light up too. Removed
  the now-dead `HoverAction`/`HoverPort` types and `portHover`/`grabHover` palette colors;
  `hoverPort` is a plain `PinRef | null`.
- **Bus drag preview** — dragging a wire from a bus output renders `n` dotted beziers (one per
  lane), spread across the source marker; they converge on the cursor until the mouse enters a
  sink terminal, where they spread across that sink's marker (lane `i → i`) until release.

## Earlier (kept as historical log — oldest)

- **Buses** — new `fan-in` / `fan-out` primitives (variable arity; bus terminal `BUS`).
- **Width is derived, not stored** — `Port.width` was removed. `portWidth(def, port)` gives
  the *intrinsic* width (fan-in output / fan-out input = arity, else 1); `pinWidth(design,
  parentDef, ref)` in `editor/geometry.ts` follows connections to inherit width through
  composite ports. `isNeutralPin` detects unconnected composite ports.
- **Validation** — `addConnection`/`retargetConnection` enforce equal width only when both
  ends are determined; a neutral port adopts the other side's width.
- **Rendering** — bus wires scale with width; bus pins larger (`3.5·√width`); hovering a bus
  pin shows an `×n` arity tooltip.
- **Bus width surfacing** — `pinWidth`/`isNeutralPin` now cross a composite's `Port.terminal`
  boundary, so a composite port wired to an internal fan-in/fan-out renders as a bus from
  the *outside* (and reports its width to the hover tooltip and wire thickness), and
  validation sees it as non-neutral (a determined width) rather than "adopt anything".
- **Bus input tooltips** — hovering an unconnected bus *input* terminal now shows its
  `×n` tooltip too (new `HoverAction` `'inspect'` for informational-only hover).
- **Grouping exposes floating pins** — `inferGroup` now also emits exposed ports: unconnected
  selected inputs become input terminals and unused selected outputs become output terminals,
  wired only internally (no external connection). Order: crossing ports first, then exposed
  (instance order, then port order).
- **Save/load** — `serialize.ts` (`serializeDesign`/`parseDesign`) round-trips the whole
  `Design` verbatim (self-contained). Toolbar Open/Save JSON wired to Blob download + hidden
  file input; load resets nav/selection and clears undo history.
- **Library export/import** — `library.ts` (`exportLibrary`/`importLibrary`) exports template
  composites + composite closure (variant stripped, primitive refs normalized to built-in
  ids); import merges with fresh collision-free ids/names (no overwrite). Library panel
  Export/Import buttons.
- **Polymorphic primitives** — `PrimitiveSpec`/`PRIMITIVE_LIBRARY` and the scattered
  `kind === '…'` switches (in `primitives.ts`, `types.ts`, `geometry.ts`, `renderer.ts`)
  are replaced by one `Primitive` class per kind in `packages/model/src/primitives/`
  (`gate.ts` base + `and/or/xor/not/clock/fan-in/fan-out/input-port/output-port.ts`). Each
  owns its ports, arity, naming, intrinsic bus width, body size, and `draw(ctx, opts)` via
  a DOM-free `VectorContext` (app adapts it with `canvasVector.ts`). Registry
  (`primitives/index.ts`) maps kind → behaviour object; `primitiveDef`, `portWidth`,
  `isNavigableDef`, `isArityFixed`, `allowRenameTerminals`, `nextPrimitiveInputName`,
  `isPortGroupDef`, `portGroupDirection` all delegate to it. `transfer` (simulation) is
  still a reserved slot.
- **Custom properties** — a primitive declares its properties via `properties(): PropertySpec[]`
  (name/label/type/default/unit/min/max/step). The CLOCK declares `period` (number, ms,
  default 1000, min 1). `Instance.props` stores per-instance values; instantiation
  (`addInstance`, paste) seeds them from `defaultPropsOf(kind)`, and `cloneDef` deep-copies
  them. The sidebar properties panel renders a generic editor (number/string/boolean, unit in
  the label) committed via `setInstanceProp`.
- **Bus split/merge** — new `bus-split` (1 bus in → 2 bus out, `in = 2×out`) and `bus-merge`
  (2 bus in → 1 bus out, `out = 2×in`) primitives, with fixed arity and no stored width.
- **Terminal layout scales with arity** — body height grows to fit bus pin radii
  (`instanceBodySize`/`sizeForPorts`/`neededHeight` in `geometry.ts`), gate shapes size their
  bus neck to the pin radius (`DrawOptions.pinRadius`), and port-name labels are offset by
  the radius — so large terminals neither overlap nor stick out of their component.
- **Terminal inversion** — `Port.inverted?: boolean` (default false) renders a hollow ring
  around the pin dot (radius `1.5×` the pin, zoom-scaled) via `drawInversionRing` in
  `renderer.ts`, on instances, composites, and port groups alike. New `buffer` primitive
  (triangle, apex at the edge); `not` now `extends Buffer` and defaults its output to
  `inverted: true` (the bubble moved out of the gate's `draw`, fixing the zoom bug).
  Toggling: `setPortInverted(portId, inverted)` (ports-editor checkbox, current def) and
  `togglePinInversion(ref)` (general pin→owning-port resolution; a port-group pin resolves to
  the current def's port). Press `i` while hovering a terminal (Canvas `onKeyDown`, gated on
  `pointerOver` + `hoverPort`) to toggle; sink hover was unified to `hasWire ? 'grab' :
  'inspect'` so every terminal is hoverable. `inverted` serializes verbatim and is inherited
  through grouping when a port group is included (`InferredInput`/`InferredOutput.inverted`).
- **Stroke terminals** — pins are no longer filled circles: each terminal is a vertical
  **stroke** along the component edge (color `pin`=blue sink / `pinHover`=green source,
  thickness `4·√width·zoom`, length `2·pinRadius`). The inversion bubble is shifted just
  outside the edge (`bubbleOnLeft`: inputs left, outputs right; port groups use `!isInput`)
  so it touches the component at the port position, and its interior fill now matches the
  effective canvas background (`templateBg` when editing a template). Shared `drawPin` helper
  (used by `drawPorts` and `drawPortGroupBox`) + `pinLabelOffset`/`PIN_LABEL_GAP`; ring draw
  order fixed (fill before stroke). Composite port labels restored to outside placement
  (inputs left / outputs right).
- **Drop-target hover** — while dragging a wire, `Canvas` `onPointerMove` (case `'wire'`)
  now hit-tests the cursor and sets `hoverPort` to a sink under it, so the renderer draws the
  highlight ring exactly when the wire can be released to connect/re-target (same
  `hitTestPort` call as `onPointerUp`).
- **Width becomes a constraint solver** — `pinWidth`/`isNeutralPin` moved to a new
  `apps/gatefold/src/editor/widths.ts`: width is now solved by fixpoint propagation over
  connection equalities, composite-terminal mirrors, fan-in/fan-out constants, and the
  `×2` relations of bus-split/merge (via `Primitive.deriveWidth`). Undetermined pins are
  neutral; a conflict or a non-integer result (odd bus into a splitter) marks the sheet
  invalid. `addConnection`/`retargetConnection` validate via `connectionError`. Undetermined
  wires render dashed; hovering an undetermined relation pin shows a hint (`"2x?"`/`"?"`).
- **Grouping** — bus width propagates through inferred ports automatically (derived from
  internal fan-in/fan-out and external connection), so `applyGroup` needed no change.
  Grouping/promotion now **deep-copy** the whole hierarchy (`copyDefSubgraph`), so canvas
  instances never share data with library templates.
- **Template editing** — double-click a composite card in the library to edit its template
  (breadcrumb shows a `template` badge); an `×` on each card deletes it (disabled while that
  template is in the breadcrumb; the store also refuses to delete a referenced or currently-
  viewed def).
- **Group dialog** — now names the new component; a single selected custom component is
  *promoted* to a new template (a fresh copy added to the library) while the instance stays
  a `variant` — no new port layer, and the clicked object remains an instance.
- **Load repair** — `sanitizeDesign` prunes dangling connections/instances from a loaded file
  and reports them (`console.warn` + a toast); `withBuiltinPrimitives` adds any newer built-ins.
- **Copy/paste carries internal wiring** — `captureClipboard` records the connections whose
  both endpoints are in the selection; `instantiateClipboard` re-creates them between the new
  instance ids.
- **Port groups are special** — `input-port`/`output-port` instances are never copied
  (`captureClipboard` filters them), and when included in a grouping they define the new
  component's interface rather than becoming internals: `inferGroup`/`applyGroup` treat them as
  external, inherit the parent's terminal **names/count** (even unwired pins), and disable
  floating-pin discovery on that side; other boundary crossings still become extra terminals.
- **Template editing visuals** — the canvas background turns light blue (`Palette.templateBg`)
  while a template is anywhere in the breadcrumb, the library card shows an "editing" badge, and
  the wire halo uses the current background color.
- **Template rename** — editing a template with nothing selected shows a name field
  (`renameDef`); template cards can also be renamed. Port-name inputs in the sidebar now refresh
  when navigating between components.
- **Undo/redo, copy/paste/delete, copy-on-place, animated port reorder, enter-any-component
  (double-click) + Escape, arity constraints** — all working (see ARCHITECTURE.md).

## Immediate next steps (pick up here)

1. **Sim polish** — per-kind/per-instance delay overrides in the settings UI; `simStore` unit
   tests. (Run is now clock-aware via the event-driven clock + advance-to-next-edge — done.)
2. **Timing accuracy (later)** — glitch/setup-hold history view; SCC-based settling for
   large designs.

## Open items / decisions to revisit

- **Def GC** — implemented: `unreachableDefIds` + `pruneOrphanedDefs` reclaim orphaned variant
  defs after delete / template-delete / apply-template and on load (see "Latest"). Done.
- **Apply-template arity matching is soft** — a neutral port matches, and a post-apply width
  conflict (neutral port wired to a fixed-width net) surfaces via the solver as a dashed wire,
  not rejected up-front.
- **Name uniqueness** not enforced (`renameInstance`/`renamePort`/port names) — cosmetic.
- Cross-level **bus width consistency** is enforced at connection time via the width solver;
  width still doesn't propagate *inward* through a composite boundary (the internal terminal
  stays authoritative), and there is no global invariant scan for pre-existing designs.
- **Power-on value** is currently fixed at `0` (floating stays `x`); not yet a user setting.
- **Floating bus pins** resolve to width 1 (`x`) in the sim (their true width is only known
  via the width solver) — cosmetic.
- OS-clipboard integration deferred (clipboard is in-app only).
- Orthogonal bus/wire routing deferred (cubic-bezier `routing.ts` isolates this).
- `PropertySpec` has no schema version stamp; number props only clamp to min/max.
- The primitive "internal circuitry" placeholder shows single pins for bus-split/merge
  (their width is instance-specific, so it can't be shown without an instance).
- **Verilog export** — future idea, captured in `PLAN.md` §12: a pure `exportVerilog(design)`
  for FPGA targeting. Key decisions deferred: combinational-only vs. adding a `DFF` primitive;
  hierarchical vs. flat modules; testbench generation; and a **floating-net validation gate**
  (only designs with no undriven nets are acceptable for codegen, since `x` isn't synthesizable).

## Commands

`pnpm dev` · `pnpm build` · `pnpm test` · `pnpm typecheck` · `pnpm lint`
