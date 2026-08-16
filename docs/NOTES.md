# Session Notes

Last updated: 2026-08-15 (post bus-split/merge + solver-based width).

## Where we are

Logica is a graphical logic-circuit designer/simulator (TypeScript + React + Zustand +
HTML5 canvas, pnpm monorepo). The editor is feature-complete for building/editing
hierarchical circuits, with JSON save/load and library export/import; only the
**simulator** remains unimplemented. See `PLAN.md` (roadmap), `docs/ARCHITECTURE.md`
(as-built design), `docs/GLOSSARY.md` (terminology).

## Latest endeavors (this session)

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
- **Width becomes a constraint solver** — `pinWidth`/`isNeutralPin` moved to a new
  `apps/logica/src/editor/widths.ts`: width is now solved by fixpoint propagation over
  connection equalities, composite-terminal mirrors, fan-in/fan-out constants, and the
  `×2` relations of bus-split/merge (via `Primitive.deriveWidth`). Undetermined pins are
  neutral; a conflict or a non-integer result (odd bus into a splitter) marks the sheet
  invalid. `addConnection`/`retargetConnection` validate via `connectionError`. Undetermined
  wires render dashed; hovering an undetermined relation pin shows a hint (`"2x?"`/`"?"`).
- **Grouping** — bus width propagates through inferred ports automatically (derived from
  internal fan-in/fan-out and external connection), so `applyGroup` needed no change.
- **Template editing** — double-click a composite card in the library to edit its template
  (breadcrumb shows a `template` badge); an `×` on each card deletes it (disabled while that
  template is in the breadcrumb; the store also refuses to delete a referenced or currently-
  viewed def).
- **Group dialog** — now names the new component; a single selected custom component is
  *promoted* to a new template (a fresh copy added to the library) while the instance stays
  a `variant` — no new port layer, and the clicked object remains an instance.
- **Load repair** — `sanitizeDesign` prunes dangling connections/instances from a loaded file
  and reports them (`console.warn` + a toast); `withBuiltinPrimitives` adds any newer built-ins.
- **Undo/redo, copy/paste/delete, copy-on-place, animated port reorder, enter-any-component
  (double-click) + Escape, arity constraints** — all working (see ARCHITECTURE.md).

## Immediate next steps (pick up here)

1. **Simulation engine** — new `packages/sim` (or extend `@logica/model`): event-driven
   combinational → clocked/sequential; hierarchy flattening via `Port.terminal`; cycle
   detection; fan-in/fan-out are per-bit identities (`out[i] = in[i]`); buses = `n`
   independent bits. The per-kind `transfer(inputs)` method belongs on the `Primitive`
   classes (next to `draw`/`properties`); the CLOCK's `period` (ms) is read from
   `Instance.props` and drives the square-wave source.
2. **Simulation UI** — run/step/stop, clock source, live signal coloring on wires/pins.

## Open items / decisions to revisit

- **Name uniqueness** not enforced (`renameInstance`/`renamePort`/port names) — cosmetic.
- **Deeply-nested grouping** isolation imperfect: a grouped *template* can reference a
  `variant` def (the store deep-copies only the top level; nested variants are shared).
- Composite **definition** renaming not implemented (only instance + port names).
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
