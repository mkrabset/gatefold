import type { CompositeDef, Design, Testbench } from './types'

/**
 * The test bench: the "one level up" sheet that wraps the top-level root. The root is
 * represented by a single fixed **main** instance whose def is always the live
 * `design.root` (resolved on demand, never stored), so edits to the root's interface
 * are reflected immediately. The reserved ids are `$`-prefixed so they can never collide
 * with user instance/definition ids (which are name-derived).
 */

/** The reserved id of the fixed "main" instance in the synthesized test-bench composite. */
export const MAIN_INSTANCE_ID = '$main'

/** The reserved id of the synthesized test-bench composite itself. */
export const TESTBENCH_COMPOSITE_ID = '$testbench'

/** A default (empty) test bench, placed with `main` at the origin. */
export function emptyTestbench(): Testbench {
  return { main: { pos: { x: 0, y: 0 } }, instances: [], connections: [] }
}

/**
 * Synthesize the test-bench composite for `testbench`: a single `main` instance (def =
 * `design.root`, named after the root) plus the external IO components and their wiring.
 * It has no ports of its own — it is the top level.
 */
export function testbenchComposite(design: Design, testbench: Testbench): CompositeDef {
  return {
    kind: 'composite',
    id: TESTBENCH_COMPOSITE_ID,
    name: 'Testbench',
    ports: [],
    instances: [
      { id: MAIN_INSTANCE_ID, name: design.root.name, pos: { ...testbench.main.pos }, def: design.root },
      ...testbench.instances,
    ],
    connections: testbench.connections,
  }
}

/**
 * Wrap a design in its test bench, returning a design whose root is the synthesized
 * test-bench composite (so the simulator and width solver see the outside-world sheet
 * as the top level). A design without a `testbench` is wrapped in an empty one, so the
 * simulation root is *always* the test bench (an empty one behaves identically to
 * simulating the bare root).
 */
export function withTestbench(design: Design): Design {
  const testbench = design.testbench ?? emptyTestbench()
  return { version: design.version, root: testbenchComposite(design, testbench), library: design.library }
}
