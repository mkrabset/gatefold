# Session Notes

Last updated: 2026-08-15 (post bus-support + width-derivation work).

## Where we are

Logica is a graphical logic-circuit designer/simulator (TypeScript + React + Zustand +
HTML5 canvas, pnpm monorepo). The editor is feature-complete for building/editing
hierarchical circuits; the **simulator** and **JSON save/load** remain unimplemented.
See `PLAN.md` (roadmap), `docs/ARCHITECTURE.md` (as-built design), `docs/GLOSSARY.md`
(terminology).

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
- **Grouping** — bus width propagates through inferred ports automatically (derived from
  internal fan-in/fan-out and external connection), so `applyGroup` needed no change.
- **Template editing** — double-click a composite card in the library to edit its template
  (breadcrumb shows a `template` badge); an `×` on each card + confirm dialog deletes it.
- **Group dialog** — now names the new component; a single selected custom component is
  *promoted* to a template (no new port layer) instead of being wrapped.
- **Undo/redo, copy/paste/delete, copy-on-place, animated port reorder, enter-any-component
  (double-click) + Escape, arity constraints** — all working (see ARCHITECTURE.md).

## Immediate next steps (pick up here)

1. **Simulation engine** — new `packages/sim` (or extend `@logica/model`): event-driven
   combinational → clocked/sequential; hierarchy flattening via `Port.terminal`; cycle
   detection; fan-in/fan-out are per-bit identities (`out[i] = in[i]`); buses = `n`
   independent bits.
2. **Save/load JSON** — serialize/deserialize the `Design`, wire the toolbar buttons.
3. **Simulation UI** — run/step/stop, clock source, live signal coloring on wires/pins.

## Open items / decisions to revisit

- **Name uniqueness** not enforced (`renameInstance`/`renamePort`/port names) — cosmetic.
- **Deeply-nested grouping** isolation imperfect: a grouped *template* can reference a
  `variant` def (the store deep-copies only the top level; nested variants are shared).
- Composite **definition** renaming not implemented (only instance + port names).
- Cross-level **bus width consistency** is enforced at connection time (a composite port's
  internal width is now visible to `addConnection`/`retargetConnection`); there is still no
  global invariant scan to flag a pre-existing inconsistent design.
- Cycle detection deferred until the simulator needs it.
- OS-clipboard integration deferred (clipboard is in-app only).
- Orthogonal bus/wire routing deferred (cubic-bezier `routing.ts` isolates this).

## Commands

`pnpm dev` · `pnpm build` · `pnpm test` · `pnpm typecheck` · `pnpm lint`
