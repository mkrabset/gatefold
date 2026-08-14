# Session Notes

Last updated: end of session (2026-08-14).

## Where we are

Logica is a graphical logic-circuit designer/simulator (TypeScript + React + Zustand +
HTML5 canvas, pnpm monorepo). The app shell, data model, canvas editor, and the
"group into component" feature are working; the simulator and persistence are not yet
started. See `PLAN.md` (roadmap) and `docs/ARCHITECTURE.md` (as-built design) for details.

## Completed this session

- pnpm monorepo setup (`apps/logica`, `packages/model`).
- Core data model migration: `ports: Port[]` + `PinRef` union.
- Group into composite: `inferGroup`/`applyGroup` in `@logica/model`, toolbar Group
  button, naming dialog, auto-rewire, library listing, ports editor.
- Canvas: bezier wires (halo + fan-out grouping), port terminals, instance-name labels,
  marquee/shift-click/group-move/shift-drag-pan/wheel-zoom, light/dark theme, resizable
  panels, tooltips.
- Instance rename (commits on Enter/blur); instance names rendered on canvas.
- Comments throughout; README.md user doc; docs kept in sync.

## Immediate next steps (pick up here)

1. **Wire tool** — make the "wire" tool functional (drag from an output pin to an input
   pin to create a `Connection`). Depends on port-terminal hit-testing.
2. **Simulation engine** — `@logica/model` (or new `packages/sim`): event-driven
   combinational → clocked/sequential, hierarchy flattening, cycle detection.
3. **Save/load JSON** — serialize/deserialize the `Design`, wire the toolbar buttons.
4. **Place-from-library** — turn library cards into placement actions.

## Open items / decisions to revisit

- `renameInstance` does **not** enforce name uniqueness yet (renaming can produce
  duplicate labels — cosmetic, not a broken reference).
- Composite **definition** renaming is not implemented (only instance + port names).
- Undo/redo (zundo) not yet attached to `editorStore`.
- Cycle detection for nested composites deferred until the simulator needs it.
- Multi-bit buses planned for later (single wires only for now).
- Orthogonal wire routing: currently cubic-bezier; router is isolated for a future swap.

## Commands

`pnpm dev` · `pnpm build` · `pnpm test` · `pnpm typecheck` · `pnpm lint`
