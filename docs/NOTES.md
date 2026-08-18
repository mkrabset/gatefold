# Session Notes

Last updated: 2026-08-18 (template apply / lineage uuid / linear terminal layout).

## Where we are

Logica is a graphical logic-circuit designer/simulator (TypeScript + React + Zustand +
HTML5 canvas, pnpm monorepo). The editor is feature-complete for building/editing
hierarchical circuits, with JSON save/load and library export/import; only the
**simulator** remains unimplemented. See `PLAN.md` (roadmap), `docs/ARCHITECTURE.md`
(as-built design), `docs/GLOSSARY.md` (terminology).

## Latest (end of this session)

- **Lineage `uuid`** — `ComponentDef.uuid?: string` tracks a component's *origin*. A template
  and every variant copied from it share the same `uuid`; def identity stays `id`.
  `newUuid()` (model `util.ts`) generates it. Assigned in `applyGroup`, `importLibrary`, the
  demo design, and on `loadProject` (migration for older saves). `cloneDef`/`copyDefSubgraph`
  preserve it (variants inherit), so `addInstance`/paste/group all link variants to their
  template automatically.
- **Apply template to matching instances** — new `apps/logica/src/editor/apply.ts`:
  `scopeDefIds` (current def + transitive nested defs), `portsMatch` (same lineage `uuid`,
  `variant`, and unaltered port ids/names/order; arity equal or either neutral; `inverted`
  ignored), and `applyTemplate` (re-instantiates a variant's internals from the template,
  preserving its port ids + `inverted` and external wiring). Store action
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

## Earlier (kept as historical log)

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
  `apps/logica/src/editor/widths.ts`: width is now solved by fixpoint propagation over
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

1. **Simulation engine** — new `packages/sim` (or extend `@logica/model`): event-driven
   combinational → clocked/sequential; hierarchy flattening via `Port.terminal`; cycle
   detection; fan-in/fan-out are per-bit identities (`out[i] = in[i]`); buses = `n`
   independent bits. The per-kind `transfer(inputs)` method belongs on the `Primitive`
   classes (next to `draw`/`properties`); the CLOCK's `period` (ms) is read from
   `Instance.props` and drives the square-wave source. **`Port.inverted` must be applied**
   (per-terminal negation) at each pin in the evaluation.
2. **Simulation UI** — run/step/stop, clock source, live signal coloring on wires/pins.

## Open items / decisions to revisit

- **No def GC** — applying a template orphans the variant's old nested closure defs (pre-existing
  pattern; serialized/save bloat only). A reachability GC pass is future work.
- **Apply-template arity matching is soft** — a neutral port matches, and a post-apply width
  conflict (neutral port wired to a fixed-width net) surfaces via the solver as a dashed wire,
  not rejected up-front.
- **Name uniqueness** not enforced (`renameInstance`/`renamePort`/port names) — cosmetic.
- Cross-level **bus width consistency** is enforced at connection time via the width solver;
  width still doesn't propagate *inward* through a composite boundary (the internal terminal
  stays authoritative), and there is no global invariant scan for pre-existing designs.
- Cycle detection deferred until the simulator needs it.
- OS-clipboard integration deferred (clipboard is in-app only).
- Orthogonal bus/wire routing deferred (cubic-bezier `routing.ts` isolates this).
- Property values are stored but not yet consumed (no simulator); number props only clamp
  to min/max (no per-spec validation); `PropertySpec` has no schema version stamp.
- The primitive "internal circuitry" placeholder shows single pins for bus-split/merge
  (their width is instance-specific, so it can't be shown without an instance).

## Commands

`pnpm dev` · `pnpm build` · `pnpm test` · `pnpm typecheck` · `pnpm lint`
