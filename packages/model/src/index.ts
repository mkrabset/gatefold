// Barrel export for `@gatefold/model` — the shared, framework-free domain model.
//
// Exports are grouped by concern (matching the module that owns each symbol) so the
// public API surface doubles as a map of the model. See docs/ARCHITECTURE.md §10 for
// the module-by-module reference.

// Core data model (plain types).
export type {
  Signal,
  PortDirection,
  PullDirection,
  Port,
  PrimitiveKind,
  PropertyValue,
  CompositeDef,
  ChildDef,
  Instance,
  PinRef,
  Connection,
  Design,
} from './types'

// Terminals: port ids and direction filtering.
export { inputPortId, outputPortId, inputPorts, outputPorts, nextPortId } from './ports'

// Connections: endpoint equality, keys, and the single-driver lookup.
export { pinRefEquals, nextConnectionId, pinKey, findConnectionTo } from './connections'

// Composite tree navigation and template queries.
export {
  walkComposites,
  collectCompositeSubtree,
  allCompositeIds,
  findComposite,
  isTemplateDef,
  templateNames,
  UNCATEGORIZED,
  templateCategory,
  templateCategories,
} from './composite'

// Generic helpers.
export { newUuid, uniqueId, UnionFind } from './util'

// Value entry / formatting (switch-array and 7-seg).
export { toValueFormat, valueFormatOf, valueOrderOf, parseSwitchValue, formatSwitchValue, applyValueOrder, switchInitialLanes, maxSwitchValueText } from './value'
export type { ValueFormat, ValueOrder } from './value'

// Bus-width resolution.
export { pinWidth, isNeutralPin, resolvedPinWidth, undeterminedHint, connectionError } from './widths'
export type { SheetWidths } from './widths'

// Grouping into composites + deep-clone.
export { cloneChildDef, cloneComposite, cloneDesign, inferGroup, applyGroup } from './group'
export type { InstancePin, InferredInput, InferredOutput, InferredGroup } from './group'

// Copy/paste.
export { captureClipboard, instantiateClipboard } from './clipboard'
export type { Clipboard } from './clipboard'

// JSON serialization, parsing, and migration.
export {
  stringifyJson,
  buildProject,
  serializeDesign,
  parseJson,
  parseDesign,
  isRecord,
  isComposite,
  sanitizeDesign,
} from './serialize'
export type { ProjectJson, SanitizeIssue } from './serialize'

// Component library exchange.
export {
  LIBRARY_VERSION,
  exportLibrary,
  serializeLibrary,
  parseLibrary,
  importLibrary,
  deleteTemplate,
} from './library'
export type { LibraryFile } from './library'

// Primitive registry and behaviour classes (their own barrel; see primitives/index.ts).
export * from './primitives'
