# Session Notes

Last updated: 2026-09-05 (nested-object model — flat `defs` id-lookup removed).

## Where we are

Gatefold is a graphical logic-circuit designer/simulator (TypeScript + React + Zustand +
HTML5 canvas, pnpm monorepo). The document is now a **nested object tree**: a composite owns
its children as inline `ChildDef`s (a shared `builtin`, an owned `fork`, or a nested
`CompositeDef`), so deleting a template deletes its children for free — there is no flat
`defs` map, no `defId` back-references, no `variant` flag, and no reachability GC. See
`docs/ARCHITECTURE.md` (as-built design) and `docs/GLOSSARY.md` (terminology).

## Latest (this session)

- **Nested-object model redesign**: replaced the flat
  `Design = { root, library, defs }` + `Instance.defId` string lookups with a tree where a
  composite owns its children inline:

  - **Model** (`packages/model/src/types.ts`) — `Design = { version, root: CompositeDef,
    library: Record<string, CompositeDef> }`; `Instance.def: ChildDef` where
    `ChildDef = builtin | fork | CompositeDef`. `builtin` is a shared immutable primitive
    reference (the port groups + the join-point); `fork` is an owned primitive with its own
    `ports` (every placed primitive, carrying per-instance `inverted`/arity); a composite is
    owned inline. `CompositeDef.instances`/`connections` are now required.
  - **Model core** — `getDef`, `combinedDefs`, `collectClosure`, `unreachableDefIds`,
    `remapInstanceDefs`, `instancesReferencing`, `isDefReferenced`, `relocateToLibrary` are
    gone. New: `cloneChildDef`/`cloneComposite` (deep-clone with fresh composite ids,
    preserving `uuid` and instance ids), `walkComposites`/`findComposite`/`allCompositeIds`.
    `inferGroup(parent, ids)` and `applyGroup(design, parentId, …)` operate on composites;
    the template owns its moved instances inline. `clipboard` deep-clones inline subtrees.
    `deleteTemplate` is `delete library[id]` + `uuid` soft-link clearing. `widths` caches by
    `WeakMap<CompositeDef, SheetWidths>` (object identity) and resolves `inst.def`.
  - **Serialization** — `{ version: 2, root: <composite>, library: { id: <composite> } }`.
    `parseDesign` migrates the v1 two-part flat shape and the older flat-`variant` shape into
    the nested model (`flatToNested`). `sanitizeDesign` drops dangling connections only.
    `stripBuiltinPrimitives`/`withBuiltinPrimitives` removed (built-ins are inline references).
  - **Sim/Verilog** — `netlist.ts`/`verilog.ts` walk the nested tree (`inst.def` instead of
    `design.defs[inst.defId]`); the flattened instance path / module naming are unchanged.
  - **App** — `navStack` is now a discriminated `NavStep[]` (`root` / `instance` / `template`),
    resolved by `resolveNav`; the sim's `path`/`viewingLive` reuse it. `editorStore` drops
    `copyDefIntoSide`/`pruneOrphanedDefs`/`findArrayRef`; port editing targets a placed
    instance by id, and `pruneConnectionsToPorts` becomes a direct-parent prune. geometry/
    renderer/wireSearch take the current `ChildDef` (no `design` threading).
  - **Tests** — fixtures rewritten to nested (model 109, sim 36, verilog 17, app 76; 238
    total). The flat-model GC/closure/remap/`withBuiltinPrimitives` tests were dropped along
    with the machinery. Architecture + glossary updated.

## Earlier (this session)

- **Two-part model: library + content tree, `variant` removed** — a large model/persistence
  refactor so that "Save JSON" and "Export library" share one code path for the library body:

  - **Model** (`packages/model/src/types.ts`) — `Design` is now `{ version, root, library,
    defs }`: `library` holds the templates (origin templates + embedded copies + primitive
    forks); `defs` holds the content tree (root + live copies + primitive forks + built-ins).
    The `variant` boolean is **removed** from `PrimitiveDef`/`CompositeDef`; whether a def is a
    template or a live object is determined purely by *location* (`getDef(design, id)` searches
    `defs` then `library`). `CompositeDef.uuid` remains as the **lineage id**: identity on an
    origin, a soft link back to the origin on a copy (embedded or live). `isTemplateDef` is now
    "a composite in `library` not referenced by any other library entry".
  - **Serialization** (`serialize.ts`) — `buildProject(design)` returns `{ version, root,
    library, defs }` and is the single source of truth: `serializeDesign` stringifies it, and
    `exportLibrary` returns its `library` field (so the library body of a saved project and an
    exported library are **byte-identical**). `parseDesign` migrates legacy flat-`defs` files
    (split on the old `variant` flag) and `unreachableDefIds` now GCs only the content tree.
  - **Library exchange** (`library.ts`) — the library is kept normalized in memory, so
    `exportLibrary` no longer transforms at export time; `importLibrary` merges into `library`
    with fresh ids/names and remaps composite `uuid`s consistently (an imported template and its
    embedded copies keep their shared soft link).
  - **Copy-on-place** (`clipboard.ts`, `group.ts`, `editorStore.ts`) — a placed/grouped copy goes
    into `defs` (live) or `library` (embedded, when editing a template) via `copyDefIntoSide`.
    `applyGroup` creates the template in `library` and `relocateToLibrary`s the moved defs'
    closure so the template is self-contained. Deleting a template now clears the `uuid` soft
    link on its copies instead of refusing on "component in use".
  - **App/UI** — `getDef` replaces `design.defs[...]` lookups across the editor/renderer/UI;
    the library panel lists `design.library` origins; `applyTemplate` matches live `defs` by
    `uuid`. `sim`/`verilog` were unaffected (they flatten the content tree only).
  - Tests updated across model/sim/verilog/app, plus new coverage: save-vs-export library
    identity, legacy migration, soft-link clearing, and embedded-copy export/import round-trip.
    Architecture, glossary, and user guide updated.

## Earlier (this session)

- **Switch-array value entry (simulate mode)** — switches can now be set by typing a whole
  value instead of clicking lanes one at a time:
  - **Model** (`packages/model/src/value.ts`, new) — a single `ValueFormat` (`HEX`/`DEC`/
    `SIGNED DEC`) and `ValueOrder` (`asc`/`desc`) with `toValueFormat`/`valueFormatOf`/
    `valueOrderOf` (defaulting to HEX/asc, so old JSONs load unchanged), BigInt-based
    `parseSwitchValue(text, format, width)` (LSB-first bits, `null` on invalid/out-of-range),
    `formatSwitchValue` (inverse), and `applyValueOrder` (desc reverses the vector). The 7-seg's
    `SevenSegMode` is **removed** and consolidated into `ValueFormat` (`sevenSegModeOf` now
    returns `ValueFormat`; `sevenSegPositionCount`/`sevenSegDigits` take it).
  - **Switch-array properties** (`switch-array.ts`) — new `valueFormat` (default HEX) and
    `order` (default asc) selects; both appear in the sidebar. `valueFormat` is the set-value
    dialog's initial radix; `order` maps typed values onto lanes (asc = lane 0 is the LSB).
    Missing keys on import fall back to HEX/asc (no `Design.version` bump).
  - **Engine** (`packages/sim/src/engine.ts`) — `setSwitchLanes(id, bits)` (pad/truncate to the
    lane count and re-drive) and `switchLanesOf(id)` (raw current lanes, for pre-fill); both work
    for WIRE and BUS modes.
  - **simStore** — `switchDialog` state (`{ instanceId, size, lanes, format, order }`) plus
    `openSwitchDialog`/`closeSwitchDialog`/`setSwitchValue` (viewingLive-guarded, mirrors
    `toggleSwitch`).
  - **Renderer/Canvas** — `switchValueBadge(...)` is the single source of truth for the `#` badge
    (drawn in the top-left corner of each switch body in sim mode); `Canvas` hit-tests it and opens
    the dialog (skipping a switch whose bus width is undetermined). Canvas Escape is suppressed
    while the dialog is open.
  - **UI** — new `SwitchValueDialog.tsx` (radix dropdown initialized from `valueFormat`, input
    pre-filled with the current value and selected, Enter commits / Escape cancels) registered in
    `App.tsx`; `.dialog-select`/`.dialog-error`/`.dialog-title-row` CSS.
  - Tests in `packages/model/test/value.test.ts` and `packages/sim/test/engine.test.ts`
    (`setSwitchLanes`/`switchLanesOf`); `array.test.ts` updated for the new props. User guide,
    glossary, and architecture updated.

- **Custom-component categories (library panel)** — the right-hand library's "My components"
  grid grew unbounded, so custom components are now organized into **categories** shown one at
  a time:
  - **Model** (`packages/model/src/types.ts`) — `CompositeDef.category?: string` (optional, so
    old JSONs load unchanged; no `version` bump). `UNCATEGORIZED` + `templateCategory(def)`
    (trimmed, defaults to `Uncategorized`). `cloneDef`'s spread already preserves `category`
    through copy-on-place, grouping, promote, and library export/import.
  - **Store** (`editorStore.ts`) — new `setDefCategory(defId, category)` action (undoable,
    mirrors `renameDef`): trims, empty clears the field, and only composite templates are
    targetable.
  - **Library panel** (`LibraryPanel.tsx`) — a category dropdown above "My components" filters
    to one category (default `All`; falls back to `All` if the selected category becomes empty).
    Selecting a card reveals a "move to category" dropdown (existing categories + **Uncategorized**
    + **＋ New category…**, which becomes an inline input committed on Enter/blur, cancelled on
    Escape) wired to `setDefCategory`. Custom-component cards are now **compact** (row layout,
    tighter padding, glyph dropped) while primitives keep their full cards; drag-to-place is
    unchanged.
  - **CSS** — new `.lib-filter` / `.lib-category-row` / `.lib-category-select` /
    `.lib-category-input` and `.lib-card.compact` rules in `index.css`.
  - Tests in `packages/model/test/types.test.ts` (`templateCategory`), `library.test.ts`
    (category survives export/import), and `editorStore.test.ts` (`setDefCategory` set/rename/
    clear + non-template rejection). User guide and glossary updated.

## Latest (previous session)

- **Composite-terminal inversion (sim + Verilog)** — inverting a *composite instance's*
  terminal (e.g. `i` on a placed `MyAndGate`) was silently ignored during simulation: the
  simulator's `netlist.ts` dissolved the composite boundary via union-find and never applied
  `Port.inverted` (it only honored the flag on leaf primitive pins). The Verilog exporter had
  the same gap (`emitCompositeInstance` connected child ports straight to parent nets).
  - **Sim** (`packages/sim/src/netlist.ts`): an inverted composite terminal now keeps its
    boundary pin and internal port-group pin as **separate nets**, joined by a synthesized
    inverter — a `buffer` flat instance whose output is `inverted` (a NOT), so an inverted
    input inverts on the way in and an inverted output on the way out. It reuses the existing
    gate evaluation path, so it runs with the **configured gate delay**; `driven[]` marks the
    target net as driven. A boundary pin now reads the raw external value while its internal
    port-group pin reads the inverted value.
  - **Verilog** (`packages/verilog/src/verilog.ts`): `emitCompositeInstance` emits a temp
    net + `assign` per inverted terminal (Verilog ports can't take an expression): an inverted
    input gets `assign tmp = ~net;` then `.port(tmp)`, an inverted output `.port(tmp)` then
    `assign net = ~tmp;` (width-aware).
  - Tests in `packages/sim/test/engine.test.ts` (composite input/output inversion, boundary
    vs internal pin values) and `packages/verilog/test/verilog.test.ts` (input/output inversion
    bridges).

- **Port groups are never invertable** — a composite's own terminals, as seen *inside* (the
  `input-port`/`output-port` port groups), can no longer be inverted, and they never render an
  inversion bubble. The `editorStore.togglePinInversion` action now early-returns when the
  hovered pin belongs to a port group, `setPortInverted` now requires an explicit `defId`
  (so it only ever targets a placed instance's terminals), the sidebar's scope ports editor
  drops the inversion checkbox (`invertAllowed` requires `defId`), and the renderer suppresses
  the bubble on port-group pins (`drawPortGroupBox` gained an `allowInversion` flag, passed
  `false` for composite port groups while the primitive "internal circuitry" placeholder keeps
  it). Inversion is now **external-only**: you invert a terminal on a placed instance, never on
  the scope's own ports. Grouping/apply propagation of existing external inversion is unchanged.
  Tests added in `editorStore.test.ts`; glossary/user-guide updated.

## Earlier (previous session)

- **Type-model hardening (format-compatible)** — a code-quality pass, no behavior or file
  format change (verified: serialized JSON stays byte-identical; `Design.version` unchanged):
  - `ComponentDef` is now a **discriminated union** `PrimitiveDef | CompositeDef` (`primitive`
    required on primitives; `instances`/`connections` on composites). Removed dozens of
    `def.primitive!` assertions and `def.kind === 'primitive' && def.primitive` guards; callers
    now narrow once on `kind`. `isComponentDef` validates that a primitive def carries a
    `primitive` (soundness of the union).
  - `Instance.props` is `Record<string, PropertyValue>` (`PropertyValue = number | string |
    boolean`) instead of `Record<string, unknown>`; `PropertySpec` is a discriminated union.
    This removed the `as SevenSegMode` / `as 'wire'|'bus'` casts and `typeof` narrowing — new
    model helpers `sevenSegModeOf(props)` and `periodOf(props)` (clock) do the narrowing, and
    `arrayTerminalType` is now derived with a ternary instead of a cast.
  - `seven-seg.ts` gained an `isBinary` type guard (replacing `Signal` → `number` casts).
  - `group.ts`/`verilog.ts` non-null `!` assertions cleaned up (port-group ids via
    `portGroupOf`; `emitPrimitive` now takes `PrimitiveDef`).
- **Barrel narrowing** — `@gatefold/sim` no longer re-exports internals (`flatten`, `delayOf`,
  `clockValue`/`equalVectors`/`invert`/`invertVector`, `Netlist`/`FlatInstance`/`FlatPort`); the
  dead `portPrimitiveDef` was removed from the model.
- **Dedup (single canonical implementations)** — `sim/signals.ts` reuses the model's
  `invertSignal`; `exportLibrary` and `LibraryPanel` reuse `isTemplateDef`; new `isArrayDef`/
  `arrayDirection` in `primitives/array.ts` (replaces the store-local predicate); new
  `nextConnectionId` (shared by `addConnection`, `insertJoinPointAt`, and clipboard paste); a
  shared `UnionFind` (model `util.ts`) replaces the copies in `netlist.ts`/`verilog.ts`/
  `renderer.ts`; `apply.ts` `scopeDefIds` delegates to `collectClosure`; `createDemoDesign`
  reuses `withBuiltinPrimitives`.
- **Encapsulation & state** — new `editorStore.resetNavigation()` action; `simStore.enterSim`
  calls it instead of reaching into the other store with `setState`. The Toolbar timing lamp now
  uses a `useShallow` selector (dropping the `version`-subscription + `getState()` hack, and
  the `simTimingStatus` helper). `Sidebar` derives the current def reactively from `navStack`
  instead of `currentDefId(useEditorStore.getState())`.
- **Connected-port-removal rule** — the UI no longer disables removing a wired port; the store's
  `removePort` (which prunes the port's connections) is now the single canonical rule
  (`SortablePortList` dropped its `isConnected` prop).
- **Documentation** — TSDoc added to core types (`Signal`, `PortDirection`, `PrimitiveKind`,
  `Connection`, `Design`, `serializeDesign`, `exportVerilog`) and non-obvious logic (`widths.ts`
  cycle-guard sentinel, Verilog `sanitizeIdentifier`/`uniqueName`, the DFF's D-by-elimination).
  `docs/GLOSSARY.md` gained: copy-link sharing (`?d=`), default program state, PNG primitive
  icons, wire-crossing search, drop-to-split, cut line, simulation speed (`timeScale`), timing
  lamp.
- **Tests** — added: `nextConnectionId`/`uniqueId`/`collectClosure`/`remapInstanceDefs`
  (util/connections), `isArrayDef`/`arrayDirection`/`sevenSegModeOf`/`periodOf` (primitives),
  editor-store single-driver + re-target rejection, and Verilog XOR/bus-split/DFF-polarity
  (negedge, `initialValue`, active-low reset).

## Earlier (previous session)

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
- **DFF `!Q` output** — the DFF now exposes a second output terminal, `!Q` (`out:1`, name "!Q"),
  carrying the complement of `Q`. Unlike a NOT-style terminal it is inverted *internally* (via a
  new `Primitive.complementPortId()`), so it has **no inversion bubble** and `out:1` has no
  `inverted` flag. The engine's sequential path was generalized from a single `qOutput` to
  `outputs: FlatPort[]`, applying the internal complement then the terminal (bubble) inversion
  per output (power-on, clock-edge sample, and async reset alike). The Verilog exporter marks
  only the first DFF output as `reg` and emits the complemented sibling as `assign !Q = ~Q;`
  (XOR-inversion against `Q`). Tests updated/added in `primitives.test.ts`, `engine.test.ts`, and
  `verilog.test.ts`.
- **"Copy to link" sharing** — a new toolbar **Copy link** button serializes the design, gzips it
  (native `CompressionStream`), base64url-encodes it, and writes a `${origin}${pathname}?d=…` URL
  to the clipboard (`navigator.clipboard`, "Link copied" toast). On startup, `main.tsx`'s async
  bootstrap decodes a present `?d=` param (`decodeDesignLink` → gunzip → JSON) and loads it via
  `loadProject`, taking precedence over the localStorage default; a missing/corrupt param falls
  back to the normal path. New `apps/gatefold/src/util/link.ts` (gzip/base64url/`encodeDesignLink`/
  `decodeDesignLink`); `editorStore` gains `copyLink()`. Tests in `util/link.test.ts` (base64url
  round-trip, missing/corrupt param, and a gzip round-trip — the latter gated on `CompressionStream`
  availability).
- **Compact serialization** — `serializeDesign` no longer dumps the `Design` verbatim. It now:
  - omits the canonical built-in primitive defs via a new exported `stripBuiltinPrimitives`
    (`kind === 'primitive' && id === primitive`), since `withBuiltinPrimitives` regenerates them on
    load;
  - prunes unreferenced `variant` copies with the existing `unreachableDefIds` GC (the same pass the
    loader runs), so saves stop carrying orphans;
  - rounds every `pos` coordinate to 2 decimals (a JSON replacer on keys `x`/`y` — sub-pixel).
  This shrinks Save JSON, the default-state blob, and the `?d=` share link. No `version` bump:
  loading already regenerates built-ins and tolerates full or compact files. Tests updated in
  `serialize.test.ts` (strip/GC/rounding) and `link.test.ts` (round-trip now via
  `withBuiltinPrimitives`).
- **Auto-fit on descent** — entering a component now auto-frames its internals from every entry
  point (canvas double-click, sidebar tree, and library-template double-click alike), not just the
  canvas. `navigateTo` increments `fitToken`, and the Canvas fit effect frames the *current* def
  (top of `navStack`) instead of only the root; the manual fit in the canvas double-click handler
  was removed. (Fixes the earlier gap where double-clicking a library template navigated without
  fitting.)
- **Light-mode sim background** — the light palette's `simBg` changed from dark green (`#0d2418`)
  to a light yellow (`#fdf6d8`); dark mode keeps `#0a1f14`.
- **Themed 7-seg colors** — the 7-seg display colors moved out of hardcoded literals in
  `renderer.ts` into the palettes: `Palette` gained `sevenSegFill`/`sevenSegStroke`/`sevenSegOff`/
  `sevenSegOn` (`packages/model/src/primitives/primitive.ts`), set per theme in `palette.ts`. Dark
  keeps the original green body + amber lit segments; light uses a light-green body and a darker
  amber for contrast.
- **Simulation speed (time-slice pacing)** — `run()` no longer advances exactly one clock edge per
  16 ms tick; it now advances a fixed slice of simulated time (`16 000 000 000 ps × timeScale`) and
  then settles. New `timeScale` in `simStore` (default `0.001`, `1` = real-time) + a "Simulation
  speed" number input in `SimSettingsDialog` (`setTimeScale`, session-only). This makes `run()`
  independent of the clock frequency and gives the intuitive property that **increasing a CLOCK's
  period slows its visible toggle rate** (a period longer than the slice just fires on a later
  tick). Dropped the old `RUN_STEP`/`nextClockEdgeDelta()` fallback in `run()`; `step()`'s
  clock-edge mode still uses `nextClockEdgeDelta()`. Very fast clocks × high speed can exceed the
  engine's `MAX_EVENTS` cap and lag (left as-is). *(Bug fixed later: the slice constant was
  originally `16_000_000` ps = 16 µs, off by 1000× from the intended 16 ms.)*
- **Canvas overlays (frequency + speed)** — new `apps/gatefold/src/util/format.ts` with
  `formatFrequency` (Hz/kHz/MHz) and `formatSpeed` (`Nx faster` / `Nx slower` / `real-time`), both
  rounding to ≤ 3 decimals and stripping trailing zeros. The renderer draws a CLOCK's **frequency**
  above its body (`1e12 / period`, period defaulting to `CLOCK_DEFAULT_PERIOD`), and — while
  simulating — a **speed badge** in the top-left corner with a subtle backdrop (`SimView.speedLabel`,
  wired from `simStore.timeScale` in `Canvas.tsx`). Tests in `util/format.test.ts`.
- **Sidebar field commits on unmount** — `CommitInput` previously committed only on blur/Enter, so
  an edit in the sidebar's name/properties/port-rename fields was lost when focus left the field by
  clicking the canvas (the selection clears, unmounting the field before `blur` fires). `CommitInput`
  now tracks the typed value (via `onChange`) and flushes it in a `useEffect` cleanup on unmount
  (only when it differs from the last committed value), so in-progress edits always commit.
- **Group dialog Enter-to-confirm** — the Group/Save-as-template dialog body is now a `<form>` whose
  `onSubmit` runs `confirmGroup()` (with `preventDefault`); the Create/Save button is `type="submit"`
  and Cancel is `type="button"`, so pressing Enter in the name (or port-name) field confirms.
- **NODE join-point primitive** — a single-wire passthrough drawn as a filled dot with its one input
  and one output terminal coincident at the center; multiple wires exit by fan-out from the single
  output. New `PrimitiveKind 'join-point'` + `JoinPoint` class (`coincidentTerminals()`, `transfer
  (inputs) => [inputs[0]]`). Geometry special-cases it (`portPosition` → center, `instanceBodySize` →
  dot); `hitTestPort` gained a `prefer?: 'source'|'sink'` param to disambiguate the coincident pins,
  and `Canvas` uses `prefer 'sink'` on drop/hover plus an **Alt+press** grab of the incoming wire.
  `wirePath(a, b, { fromJoin, toJoin })` collapses the nearest control point onto a join endpoint so
  wires radiate from the dot. The renderer draws the dot (wire-colored, signal-colored in sim, red on
  hover) with no pin markers/labels; Verilog emits `assign Y = A;`. Terminal inversion is **disabled**
  on a NODE (both sides): `Primitive.allowInversion` (false on `JoinPoint`, default true) + a
  `allowInversion(def)` helper gate `setPortInverted`/`togglePinInversion` and the sidebar's inversion
  checkbox. Tests in `primitives.test.ts`, `transfer.test.ts`, `engine.test.ts`, `verilog.test.ts`,
  `routing.test.ts`.
- **Wire-crossing search** — new `apps/gatefold/src/editor/wireSearch.ts` with `findWireAtLine(design,
  parentDef, a, b)`: reconstructs each connection's rendered bezier (single wires, and per-lane beziers
  for buses), flattens each cubic (de Casteljau subdivision) and intersects it with the query segment,
  returning `{ connection, point }` only when exactly one single-wire connection is crossed
  (ambiguous / bus / degenerate → null). Tests in `wireSearch.test.ts`.
- **Drop a NODE onto a wire** — dragging a NODE from the library onto a single wire now splits it:
  `findJoinpointWire` (two 45° diagonals through the drop point, `JOINPOINT_PICK_HALF = 16`) picks the
  wire, and a new `editorStore.insertJoinPointAt(connectionId, pos)` action replaces the connection
  with `from → node.in:0` and `node.out:0 → to` (undoable, copy-on-place). The library drag shows the
  NODE as a filled-circle drag image sized to the dropped dot (radius `4·zoom`). Tests in
  `wireSearch.test.ts` and `editorStore.test.ts`.
- **Verilog source→sink bridge** — fixed a generator bug where a switch wired straight to an LED (a
  module input and output sharing one net) produced an empty module with disconnected ports. Net naming
  now names a net after its driver side (source / composite input) and emits an
  `assign <output> = <net>;` for every module-output pin (sink / composite output) whose name differs —
  so `switch → LED` emits `assign LEDS_BUS = SWITCHES_BUS;` (and a gate fanning out to two sinks also
  bridges the second). Test in `verilog.test.ts`.
- **Ctrl/Cmd+drag cut line** — a new gesture: hold Ctrl (or Cmd) and drag to draw an imaginary dashed
  line (a transient `cutLine` store state rendered by `drawScene`); on release `findWireAtLine` runs on
  that line and, on a hit, `insertJoinPointAt` inserts a NODE at the crossing point (`hit.point`),
  slicing the wire. New `cut` variant in the Canvas `Drag` union.
- **Grouping port placement** — fixed where a newly-created composite's input/output port groups land:
  - `confirmGroup` now places the **template's** port groups (via `portPlacement`) *before*
    copy-on-place, so the library template, the grouped variant, and any instance later dragged from the
    template all get correct positions — previously only the freshly-grouped *variant* was re-placed,
    leaving the template (and future copies) at the `centroid ± 120` placeholder (which, for wide
    selections, sat "towards the centre" on top of components).
  - When the parent's `input-port`/`output-port` instances are **included in the selection**,
    `inferGroup` now exposes `inputPortIncluded`/`outputPortIncluded` and `applyGroup` places the new
    composite's port groups at the **original positions**, and `confirmGroup` skips re-placement for those
    sides — so ports keep their exact pre-group positions relative to the components.
  Tests in `group.test.ts` (original positions) and `editorStore.test.ts` (wide-group auto-placement and
  inherited-position preservation).
- **Shift+drag a terminal moves its component** — holding Shift and drag-starting on a terminal marker
  now drags the owning component (and the whole selection if it's already part of it), overriding the
  Shift-pan that used to happen when hovering a marker. Makes it easy to grab tiny/coincident-terminal
  components (like the NODE dot). Extracted a `startMoveDrag` helper in `Canvas.tsx` shared by this and
  the normal body-press move; Shift+click on a marker now *selects* (rather than toggling) the component.
- **Join-point halo + net bunching (rendering)** — join-points now render *as part of their wire net*,
  with a halo. `renderer.ts` builds a union-find over `pinKey`s (union each connection's endpoints + each
  join-point's `in:0`/`out:0`) and groups wires by `find(pinKey(conn.from))`; each group renders in the
  order **line halos → dot halos → lines → dots**, so connected wires run cleanly into every dot (no gap)
  while crossing wires get a halo gap — and any number of join-points per net works. Join-points moved out
  of the instances loop into the group pass (new `drawJoinpointHalo`/`drawJoinpointNode` helpers, reusing
  `drawJoinpoint`); unconnected dots still get halo + dot. `drawInstance`'s join-point branch removed.
- **Smaller BUFFER/NOT triangle** — `Buffer.bodySize()` reduced from `{w:48,h:44}` to `{w:28.8,h:26.4}`
  (60%); `NotGate` inherits it.
- **PNG primitive icons** — the top-level `icons/` folder (16 PNGs, one per placeable primitive) moved
  into the app as `apps/gatefold/src/icons/` and a new `icons/index.ts` maps each `PrimitiveKind` to its
  bundled image (`PRIMITIVE_ICONS`, port groups → `undefined`). The library panel's primitive cards now
  render an `<img class="lib-icon">` instead of the text `Primitive.glyph`, and the left sidebar's
  component tree uses the same icons for primitive instances (`TreeItem` gained an `iconSrc` prop;
  composites/port groups keep the `▣` text glyph). Icons are sized in CSS (`height`, `width:auto`) so
  cards/tree rows don't grow: `.lib-icon` (29px) and `.tree-icon-img` (17px); `draggable={false}` on the
  images so they don't fight the card's drag-to-place.
- **Brighter library cards** — new `--card` CSS variable (dark `#3a4452`, light `#ffffff`) backs
  `.lib-card`, brighter than `--panel-2` so the icons' black contour lines read against the background.
- **Gate/component label cleanup** — `renderer.ts` no longer draws the type name *above* instances
  except the arrays: AND/OR/XOR now write their type label *inside* the gate body (centered, `11·zoom`),
  `switch-array`/`led-array` keep their label above the body, and every other primitive — plus
  composites (whose `def.name` above the box was dropped) — omits the type label. The instance name is
  still drawn below (primitives) or centered (composites), so CLOCK keeps its frequency label above and
  the DFF keeps its in-body terminal names.
- **Empty default instance names** — `addInstance` (library drop) now names new instances `''` instead
  of the def name, except `clock` and `dff` (which keep their label); `insertJoinPointAt` also names the
  inserted NODE `''`. Instance `id`s still derive from the def name, so uniqueness is unaffected.

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
- **Clock & step** — CLOCK `period` (ps, now `100 000` default) drives a square wave via
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

## Earlier (previous session — dedup pass)

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
