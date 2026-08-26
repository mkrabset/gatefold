# gatefold

A graphical designer and simulator for logic circuitry, running in the browser.
Build circuits out of logic gates and buses, group them into reusable components,
and simulate them — including clocked, sequential behavior built from gates.

> **Status: early pre-alpha.** The features listed below reflect what works today;
> see `PLAN.md` for the roadmap.

---

## Features

- **Primitive components** — AND, OR, XOR, NOT, BUFFER, CLOCK, FAN-IN, FAN-OUT,
  BUS-SPLIT, BUS-MERGE, BUS, plus the probe primitives SWITCHES, LEDS, and
  7-SEG (multi-digit). Gates with variable arity (AND/OR/XOR, fan-in/fan-out) accept
  a configurable number of terminals.
- **Schematic canvas** — pan (Shift + drag), zoom (mouse wheel), and drag components.
  Entering a component auto-frames its internals; Escape restores the view you left.
- **Multi-selection** — rubber-band (marquee) select, Shift + click to toggle, drag a
  selected component to move them all.
- **Wiring** — drag from an output pin to an input pin; grab an existing wire (from its
  input pin) to re-target or delete it. A pin can only be driven by one wire.
- **Buses** — multi-wire terminals with derived widths (fan-in/fan-out, bus-split/merge,
  the BUS primitive, and neutral "adopt" pins). Hover a bus pin to see its `×n` arity.
- **Hierarchy** — group a selection into a named composite component; inputs/outputs are
  inferred from the wires crossing the selection. Components are copied when placed, so
  edits never affect the template or sibling instances.
- **Editing internals** — double-click any component (composite or gate) to enter it;
  press Escape to go back up.
- **Port editing** — add, remove, rename, reorder, and invert a component's terminals.
- **Copy / paste / delete** and **undo / redo**.
- **Component properties** — per-instance values (e.g. CLOCK `period`, BUS `lanes`,
  7-SEG `order`, array `terminalType`).
- **Save / load** — whole designs as JSON; library export/import for custom components; and
  **Verilog export** (synthesizable `.v` for FPGA/HDL, via a toolbar button or a CLI).
- **Simulation** — design/simulate modes with Run/Step/Stop/Reset, signal-colored wires
  (`1` red, `0` black, `x` gray) on a dark-green canvas, a CLOCK source, interactive
  switch/led/7-seg probes, and configurable gate delays + step modes. **Run** enters simulate
  mode and starts running; **Space** toggles run/pause; **Escape** exits at the top level.
- **Theming** — light and dark modes, resizable panels; preferences persist across reloads.

## How to run

Requires [Node.js](https://nodejs.org) and [pnpm](https://pnpm.io).

```sh
pnpm install
pnpm dev
```

Open the URL printed by Vite (usually <http://localhost:5173>).

## Documentation

- **[User guide](docs/USER_GUIDE.md)** — the interface, the canvas, and every primitive,
  with a chapter on simulation.
- **[Architecture](docs/ARCHITECTURE.md)** — the as-built design and data model.
- **[Glossary](docs/GLOSSARY.md)** — terminology.
- **[Session notes](docs/NOTES.md)** — a running log of what changed and why.
- **[Roadmap](PLAN.md)** — what's still coming.

## Tech stack

TypeScript · React · Zustand · HTML5 canvas, in a pnpm monorepo
(`apps/gatefold` + `packages/model` + `packages/sim` + `packages/verilog`).

## Development

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start the dev server |
| `pnpm build` | Type-check and produce a production build |
| `pnpm test` | Run the test suites (Vitest) |
| `pnpm typecheck` | Type-check all packages |
| `pnpm lint` | Lint (oxlint) |
