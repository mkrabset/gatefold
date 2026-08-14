# logica

A graphical designer and simulator for logic circuitry, running in the browser.
Build circuits out of logic gates, group them into reusable components, and
(soon) simulate them — including clocked, sequential behavior.

> **Status: early pre-alpha.** This is a work in progress. The features listed
> below reflect what works today; see the roadmap for what's still coming.

---

## Features

- **Primitive components** — AND, OR, XOR, NOT, and CLOCK.
- **Schematic canvas** — pan (Shift + drag), zoom (mouse wheel), and drag components around.
- **Multi-selection** — rubber-band (marquee) select on empty space, Shift + click to
  toggle individual components, and drag one selected component to move them all.
- **Hierarchy** — group a selection into a named composite component. Inputs/outputs are
  inferred automatically from the wires crossing the selection boundary and can be
  named in a dialog.
- **Component tree** — browse the hierarchy in the sidebar, double-click a composite to
  descend into it, and navigate back with the breadcrumb trail.
- **Port editing** — add, remove, and rename a composite's inputs and outputs.
- **Component properties** — rename a component (press Enter in the name field).
- **Theming** — light and dark modes, plus resizable side panels. Preferences persist
  across reloads.

## How to run

Requires [Node.js](https://nodejs.org) and [pnpm](https://pnpm.io).

```sh
pnpm install
pnpm dev
```

Open the URL printed by Vite (usually <http://localhost:5173>).

## Using the interface

The screen is split into a **toolbar** (top), a **sidebar** (left), the **canvas**
(center), and the **library** (right).

| Where | What it does |
|-------|--------------|
| Toolbar | Tools (select / wire / pan), group action, simulation controls, breadcrumb, theme toggle |
| Sidebar | Component tree, selected-component properties, and the port editor |
| Canvas | The schematic — where you pan, zoom, select, and arrange components |
| Library | The primitive palette and your composite components |

### Canvas controls

- **Drag a component** to move it. If it's part of a selection, the whole selection moves.
- **Drag on empty space** to draw a marquee and select everything inside it.
- **Shift + click** a component to add it to / remove it from the selection.
- **Shift + drag** to pan, **mouse wheel** to zoom (anchored at the cursor).

### Grouping into a component

1. Multi-select the components you want to group (marquee or Shift + click).
2. Click the **group** button in the toolbar.
3. Name the inferred inputs and outputs in the dialog, then **Create**.
4. The new component appears under **My components** in the library and in the tree.
5. Double-click it in the tree to open it, and edit its ports in the sidebar.

---

## Not implemented yet

- **Wire tool** — drawing new wires between pins (button is a placeholder).
- **Simulation** — running the circuit (run/step/stop are placeholders).
- **Save / load** — JSON import/export (buttons are placeholders).
- **Placing from the library** — library cards are currently cosmetic.
- **Undo / redo**.

See [`PLAN.md`](PLAN.md) for the full roadmap and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
for the design.

## Tech stack

TypeScript · React · Zustand · HTML5 canvas, in a pnpm monorepo
(`apps/logica` + `packages/model`).

## Development

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start the dev server |
| `pnpm build` | Type-check and produce a production build |
| `pnpm test` | Run the test suites (Vitest) |
| `pnpm typecheck` | Type-check all packages |
| `pnpm lint` | Lint (oxlint) |
