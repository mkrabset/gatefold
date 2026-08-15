# Session Notes

Last updated: end of session (2026-08-15).

## Where we are

Logica is a graphical logic-circuit designer/simulator (TypeScript + React + Zustand +
HTML5 canvas, pnpm monorepo). The editor is feature-rich: wiring, hierarchical components,
port editing, copy/paste/delete, and undo/redo all work. The **simulator** and **JSON
save/load** are the main things still missing. See `PLAN.md` (roadmap) and
`docs/ARCHITECTURE.md` (as-built design).

## Completed this session

- **Port components** — a composite's ports are `input-port`/`output-port` *group*
  instances (single movable rectangle per direction, terminals derived from the parent's
  ports); this eliminated the source/sink ambiguity and made all wiring plain output→input.
- **Arity constraints** — `PrimitiveSpec` gained `fixedInputs` / `fixedOutputs` /
  `allowRenameTerminals`; AND/OR/XOR have variable inputs (parity for XOR), NOT/CLOCK are
  fixed, built-ins aren't renamable.
- **Enter any component** — double-click composites *and* gates (gates show an "Internal
  circuitry" placeholder + port groups); Escape exits.
- **Copy-on-place** — templates are immutable; placing/grouping deep-copies a template
  (and its whole hierarchy) into `variant` defs, so instances are independent from birth.
- **Wire editing** — create wires (output→input), grab/re-target/delete from an input pin,
  single-driver invariant with rejection toast, hover highlights.
- **Copy / paste / delete / undo / redo** — in-app clipboard (`clipboard.ts`: deep-copy
  with id rewriting), zundo `temporal` (`partialize`d to `design`), drag coalescing, global
  shortcuts.
- **Port reordering** — animated drag-to-reorder via @dnd-kit/sortable.
- **Instance rename** commits on Enter/blur; instance names render on the canvas.
- Docs, comments, and a user README kept in sync.

## Immediate next steps (pick up here)

1. **Simulation engine** — new `packages/sim` (or extend `@logica/model`): event-driven
   combinational → clocked/sequential, hierarchy flattening (map composite ports via
   `Port.terminal`), cycle detection.
2. **Save/load JSON** — serialize/deserialize the `Design`, wire the toolbar buttons.
3. **Simulation UI** — run/step/stop, clock source, live signal coloring on wires/pins.

## Open items / decisions to revisit

- **Name uniqueness** is not enforced (`renameInstance`, `renamePort`, port names) — cosmetic
  duplicates are possible.
- **Deeply-nested grouping** isolation is imperfect: a grouped *template* can still reference
  a `variant` def (the store deep-copies the template for the grouped instance, but nested
  variants are shared). Common cases are covered; a full transitive copy for grouping is a
  possible follow-up.
- Composite **definition** renaming is not implemented (only instance + port names).
- Cycle detection for nested composites deferred until the simulator needs it.
- Multi-bit buses planned for later (single wires only for now).
- Orthogonal wire routing: currently cubic-bezier; router is isolated for a future swap.
- OS-clipboard integration deferred (clipboard is in-app only).

## Commands

`pnpm dev` · `pnpm build` · `pnpm test` · `pnpm typecheck` · `pnpm lint`
