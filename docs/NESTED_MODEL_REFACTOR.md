# Plan: Nested-object model redesign (drop the flat `defs` id-lookup)

> **Status: Implemented** (2026-09-05). The nested model is the as-built shape now — see
> `docs/ARCHITECTURE.md` §2, `docs/GLOSSARY.md`, and `docs/NOTES.md` for the current state.
> This document remains the record of the plan and the locked decisions (§7).

## 1. Goal

Change Gatefold's data model so that a component's children are **actual nested object
references** (owned child objects), instead of the current **flat map of defs referenced
by string ids**.

Specifically: a composite `ander2` that contains two copies of `ander` should *own* those
two `ander` defs as inline child objects. Deleting `ander2` then deletes its children for
free (no reachability bookkeeping), and the children are structurally invisible outside
their parent.

This is the "bigger task" deferred after the smaller subtree-deletion fix (see §3).

## 2. Background & motivation

The motivation is a bug that was already reported and *partially* fixed:

1. Group a component (e.g. an AND into `ander`).
2. Place `ander` on the canvas, duplicate it, group the two into `ander2`.
3. Delete `ander2` from the canvas, then delete the `ander2` template from the library.

Result (before the fix): two orphaned `ander` copies appeared in the library as visible
templates, because deleting a template did not delete its *embedded parts* (the child defs
reachable only from that template).

We shipped a **small fix** for this: `deleteTemplate` (in `packages/model/src/library.ts`)
now deletes a template together with its embedded parts (a transitive closure walk over the
flat library map), and `confirmDeleteTemplate` in the store calls it. That fix is done and
tested.

The user would still prefer the **structural** solution: make children real owned objects
so this class of problem cannot occur, and so the model reflects the true tree shape. This
document plans that redesign.

## 3. Current state — what is already settled (do not redo)

These refactors are already implemented in the working tree and covered by tests:

- **Two-part model.** `Design = { version, root, library, defs }`. `library` holds
  templates (origin templates + embedded copies + primitive forks); `defs` holds the
  content tree (root + live copies + primitive forks + built-ins). Location determines
  role; there is **no `variant` flag anymore**.
- **`uuid` lineage soft link.** `CompositeDef.uuid` is a template's identity, or a copy's
  link back to its origin template. Used by "apply template". Cleared when the origin is
  deleted.
- **Shared serialization.** `buildProject(design)` in `packages/model/src/serialize.ts`
  produces `{ version, root, library, defs }`. `serializeDesign` stringifies it;
  `exportLibrary` returns `buildProject(design).library`, so Save JSON and Export library
  share one code path and produce byte-identical library bodies.
- **Legacy migration.** `parseDesign` migrates old flat-`defs` files (with `variant`
  flags) into the two-part shape.
- **Name uniqueness is template-scoped.** `templateNames(design)` (types.ts) returns origin
  template names; grouping/promote/rename collide only against these.
- **Subtree delete.** `deleteTemplate(design, id)` (library.ts) deletes a template + its
  embedded parts and clears `uuid` soft-links on live copies.
- **Docs** updated in `docs/ARCHITECTURE.md`, `docs/GLOSSARY.md`, `docs/USER_GUIDE.md`,
  `docs/NOTES.md`.

Baseline: `pnpm test` = **247 tests** (model 117, sim 36, verilog 17, app 77);
`pnpm lint`, `pnpm typecheck`, `pnpm build` all green.

## 4. Current data model (what we are replacing)

All in `packages/model/src/types.ts`:

```ts
interface Design {
  version: number
  root: string                                       // id of root composite
  library: Record<string, ComponentDef>              // templates (flat map)
  defs: Record<string, ComponentDef>                 // content tree (flat map)
}

interface Instance {
  id: string
  name: string
  defId: string                                      // STRING reference into library/defs
  pos: { x: number; y: number }
  props?: Record<string, PropertyValue>
}

interface PrimitiveDef {
  id: string; name: string; kind: 'primitive'; primitive: PrimitiveKind; ports: Port[]
}
interface CompositeDef {
  id: string; name: string; kind: 'composite'; ports: Port[]
  instances?: Instance[]; connections?: Connection[]
  uuid?: string; category?: string
}
type ComponentDef = PrimitiveDef | CompositeDef

interface Port { id: string; name: string; direction: 'input' | 'output'
                 terminal?: { instanceId: string; pinId: string }; inverted?: boolean }
type PinRef = { instanceId: string; portId: string }
interface Connection { id: string; from: PinRef; to: PinRef }
```

Key helper:

```ts
export function getDef(design: Design, id: string): ComponentDef | undefined {
  return design.defs[id] ?? design.library[id]
}
```

The parent→child "reference" is the string `Instance.defId`, resolved through `getDef`.
The child object is a **sibling entry in the same flat map**, not owned by the parent.

### The observation that makes nesting possible

Copy-on-place guarantees that **every non-built-in def is referenced by exactly one
instance** (each placement/paste creates fresh def copies; grouping moves them, never
shares them). So a non-built-in def can be inlined into its single owning instance.

The only shared defs are the **built-in primitives** (`and`, `or`, `clock`, the port groups
`input-port`/`output-port`, …), which must stay a shared registry referenced by kind.

## 5. Target data model (proposal — refine naming as needed)

```ts
// A child is either a reference to a shared built-in primitive (by kind), an owned
// primitive fork, or an owned composite.
type ChildDef =
  | { kind: 'builtin'; primitive: PrimitiveKind }                 // port groups, join-point
  | { kind: 'fork';    primitive: PrimitiveKind; ports: Port[] }  // every placed primitive
  | CompositeDef

interface Instance {
  id: string
  name: string
  pos: { x: number; y: number }
  props?: Record<string, PropertyValue>
  def: ChildDef
}

interface CompositeDef {
  kind: 'composite'
  id: string            // stable identity (templates, root, and copies all keep it)
  name: string
  uuid?: string         // lineage: origin identity / copy→origin soft link
  category?: string     // templates only
  ports: Port[]
  instances: Instance[]   // required (no longer optional)
  connections: Connection[]
}

interface Design {
  version: number
  root: CompositeDef                           // nested content tree
  library: Record<string, CompositeDef>        // templates, still keyed by id (for export/panel)
}
```

Notes:

- **The `fork` arm is the common case, not the exception.** Copy-on-place forks *every*
  placed primitive today (`copyDefSubgraph`'s `skip` excludes only port groups), because
  per-instance terminal `inverted` and array `terminalType`/wire-count are stored on the
  def's `ports`. A shared `builtin` can't carry that. So: `fork` = any placed primitive;
  `builtin` = only the port groups (`input-port`/`output-port`, pins derived from the
  parent composite) and the join-point (fixed coincident terminals). No "builtin → fork
  promotion" logic is ever needed.
- **Port groups** are built-ins. A composite's `ports[i].terminal` still points at an
  internal `input-port`/`output-port` instance by `instanceId` (local to that composite).
- **Templates keep `id`** for export keys, the library panel, and navigation; the root and
  inline copies keep an `id` too (a pure identity label for the widths cache, sim/verilog
  module naming, and navigation), regenerated on clone.

## 6. Impact analysis — every subsystem that resolves `Instance.defId`

Use `rg "defId" packages apps` to find all sites. The full list today:

### Model (`packages/model/src/`)
- **`types.ts`** — `Design`, `Instance`, def unions, `getDef`, `isTemplateDef`,
  `isEmbeddedInLibrary`, `templateNames`, `instancesReferencing`, `isDefReferenced`.
  `instancesReferencing`/`isDefReferenced` (scan all defs for a `defId`) become tree-walks
  or are dropped.
- **`util.ts`** — `collectClosure` (walks `defs[inst.defId]`), `combinedDefs`,
  `unreachableDefIds` (content-tree GC over flat `defs`), `remapInstanceDefs`.
  Reachability GC changes shape entirely (a nested tree has no orphans).
- **`group.ts`** — `cloneDef`/`cloneDesign` (deep clone), `inferGroup`/`applyGroup`,
  `relocateToLibrary` (moves defs from `defs`→`library`; disappears in a nested model —
  children are already owned by the template).
- **`clipboard.ts`** — `copyDefSubgraph` (copy a def + closure via defIds), `captureClipboard`,
  `instantiateClipboard`. Becomes deep-clone of an inline subtree; **no id remapping needed**
  (children are owned).
- **`library.ts`** — `exportLibrary`/`importLibrary`/`deleteTemplate`/`templateClosure`.
  `deleteTemplate`'s closure walk disappears (delete the template object = children gone).
  Import becomes deep-clone + `uuid`/`id`/`name` remap of a nested tree.
- **`serialize.ts`** — `buildProject`, `parseDesign`, `migrateLegacyDesign`, `sanitizeDesign`,
  `stripBuiltinPrimitives`, `isComponentDef`/`isDesign` validation. Serialization becomes
  nested JSON; **legacy migration must convert flat→nested** (bigger than before).
- **`widths.ts`** — `computeSheet` resolves `design.defs[inst.defId]` and caches by def id
  (`WeakMap<Design, Map<defId, SheetWidths>>`). Cache key and recursion change (object
  identity or a path key).

### Sim & Verilog (`packages/sim`, `packages/verilog`)
- **`sim/src/netlist.ts`** — `flatten` walks `design.defs[inst.defId]`; change to
  `inst.def` (built-in vs inline). Flattened instance paths use instance ids (unchanged).
- **`verilog/src/verilog.ts`** — `Generator` walks `design.defs[inst.defId]`; same change.

### App (`apps/gatefold/src/`)
- **`state/editorStore.ts`** — the biggest consumer. `navStack` (list of def ids) + `currentDefId`,
  `copyDefIntoSide`/`currentSide`, `pruneOrphanedDefs`, `addInstance`, `addConnection`,
  `deleteSelection`, `confirmGroup`/promote, `renameDef`/`setDefCategory`, `setPortInverted`,
  `findArrayRef`, `applyArrayTerminalType`/`applyArrayPortCount`, `pruneConnectionsToPorts`.
- **`editor/apply.ts`** — `scopeDefIds` (closure of def ids), `applyTemplate` (match live
  copies by `uuid`; re-instantiate from template). Becomes recursion over the nested tree.
- **`state/simStore.ts`** — `viewingLive()` walks `editor.design.defs` by a `path` of
  instance ids (already path-based for the content tree; adapt to nested).
- **`state/defaultState.ts`** — `repairDesign` (parse → `withBuiltinPrimitives` →
  `sanitizeDesign` → uuid backfill → GC). GC of nested tree is trivial/none.
- **`util/link.ts`** — uses `serializeDesign` (no change beyond serialization).
- **`editor/geometry.ts`, `editor/renderer.ts`, `editor/wireSearch.ts`** — resolve
  `getDef(design, inst.defId)`; change to `inst.def`.
- **`ui/Canvas.tsx`, `Sidebar.tsx`, `Toolbar.tsx`, `LibraryPanel.tsx`, `DeleteDialog.tsx`** —
  `design.defs[...]`/`getDef` lookups and `navStack`/`currentDefId` usage.

## 7. Design decisions — LOCKED (next session: execute, don't re-litigate)

1. **Nest both `library` and the content tree.** `root` is a `CompositeDef`; `library` is
   `Record<string, CompositeDef>`; there is no `defs` map. Reachability GC disappears.
2. **Built-ins stay a shared registry**, but only the port groups and the join-point are
   `builtin`. Every placed primitive is a **`fork`** (see §5 note): copy-on-place already
   forks all primitives today because per-instance `inverted`/arity live on the def's ports.
3. **`id` is kept on every composite** (root, templates, inline copies), regenerated on
   clone. Ownership is structural (no `defId` back-pointer); `id` is a pure identity label.
4. **Navigation** becomes a discriminated path:
   `NavStep = { kind:'root' } | { kind:'instance'; id } | { kind:'template'; id }`.
   One shared `resolveNav(design, navStack): CompositeDef` walks from `design.root`; the
   sim's `path`/`viewingLive` reuses it.
5. **`instancesReferencing` / `findArrayRef` / `pruneConnectionsToPorts`** collapse to
   direct-parent operations (single ownership). Verified sound: `pruneConnectionsToPorts`
   is only ever called on owned copies, whose parent is unique.
6. **Serialization** `{ version: 2, root: <composite>, library: {id: <composite>} }`; child
   defs serialize as `{kind:'builtin',primitive}` / `{kind:'fork',primitive,ports}` / inline
   composite. Migration handles v2 (validate), v1 two-part (`flatToNested`), and the old
   flat-variant (migrate → `flatToNested`).
7. **Undo** stays `partialize: {design}`. The widths cache becomes
   `WeakMap<CompositeDef, SheetWidths>` (auto-invalidates on immer's new object identity).

## 8. Strategy / phasing

Keep the codebase green at every phase boundary (`pnpm lint`, `pnpm typecheck`,
`pnpm test`, `pnpm build`).

- **Phase 0 — Decisions.** Lock the answers to §7 in this file (or a NOTES.md entry).
- **Phase 1 — Model types.** Rewrite `types.ts` to the nested shape; add a nested deep-clone
  and the `builtin`/`fork`/`composite` `ChildDef` helpers. Stub out the now-unneeded helpers.
- **Phase 2 — Model core.** Port `group.ts`, `clipboard.ts`, `library.ts`, `util.ts`,
  `widths.ts` to the nested model (deep-clone, no id-remapping, no `getDef`).
- **Phase 3 — Serialization.** Nested `buildProject`/`parseDesign`, legacy flat→nested
  migration, validation.
- **Phase 4 — Sim + Verilog.** `netlist.ts` and `verilog.ts` traversal.
- **Phase 5 — App store + apply.** `editorStore.ts`, `apply.ts`, `defaultState.ts`,
  `simStore.ts` (navigation redesign is the hardest part).
- **Phase 6 — UI/editor.** `geometry.ts`, `renderer.ts`, `wireSearch.ts`, `Canvas.tsx`,
  `Sidebar.tsx`, `Toolbar.tsx`, `LibraryPanel.tsx`, `DeleteDialog.tsx`.
- **Phase 7 — Tests + docs.** Update fixtures (they all build flat `defs` maps), add
  encapsulation/deletion tests, update `ARCHITECTURE.md`/`GLOSSARY.md`/`USER_GUIDE.md`/`NOTES.md`.

Recommended order is model-first (types → core → serialize), then the two pure consumers
(sim/verilog), then the app. Each phase ends with a full green test run.

## 9. Testing strategy

- **Behavior, not structure.** Reuse the existing 247 tests as the spec — they assert
  behavior (grouping, copy/paste, apply, serialize round-trips, sim, verilog) and should
  keep passing with minimal semantic change even as the internal representation changes.
- Test fixtures currently construct flat `defs` maps; they will need to be rewritten to the
  nested shape. Expect a large but mechanical test-update pass.
- Add new tests for what the redesign buys:
  - deleting a template removes its owned children (regression for the original bug, now
    structural);
  - children are invisible outside their parent (e.g. `templateNames` / library panel);
  - serialization round-trip of nested trees + legacy migration;
  - "apply to instances" recursion over the nested tree (uuid matching).

## 10. Risks & edge cases

- **Navigation redesign** is the most error-prone part (mixed instance-path vs template-open).
- **Migration correctness** — must reproduce the current flat files exactly from nested
  (and vice versa) or users lose work on upgrade.
- **Immutable/immer** subtleties (structural sharing, the move-drag coalescing).
- **`applyTemplate` matching** must still find live copies by `uuid` and re-instantiate their
  internals; confirm it works with owned (not id-addressed) children.
- **Port groups** remain built-in instances; make sure `Port.terminal` still resolves
  correctly under nesting.
- **Built-in forks** (custom-arity fan-in/AND) must be represented as owned `fork` defs, and
  the sidebar's array/arity editing must operate on the owned fork.

## 11. Definition of done

- Nested model compiles and all existing + new tests pass (lint/typecheck/test/build green).
- The original bug scenario works with **no explicit subtree-deletion code** (children are
  gone because they are owned).
- Legacy flat files still load via migration; Save JSON / Export library still share one
  code path.
- "Apply to instances" works by recursion.
- Docs (`ARCHITECTURE.md`, `GLOSSARY.md`, `USER_GUIDE.md`, `NOTES.md`) updated.

## 12. Boot-up & commands

```sh
pnpm install          # if node_modules is missing
pnpm test             # baseline: 247 tests
pnpm typecheck
pnpm lint
pnpm build
pnpm dev              # manual verification in the browser
```

Key files to re-read first: `packages/model/src/types.ts`, `packages/model/src/group.ts`,
`packages/model/src/clipboard.ts`, `packages/model/src/serialize.ts`,
`apps/gatefold/src/state/editorStore.ts`, `apps/gatefold/src/editor/apply.ts`.
