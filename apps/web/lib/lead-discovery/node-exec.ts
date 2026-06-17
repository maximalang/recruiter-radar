/**
 * Runtime accessor for `child_process.execFile`.
 *
 * WHY THIS EXISTS: Turbopack's static analyzer treats a direct
 * `import { execFile } from 'node:child_process'` followed by a spawn as a
 * `<dynamic>` module reference and fails the build. Resolving the builtin via
 * `process.getBuiltinModule` is fully opaque to bundler static analysis — the
 * module is never traced, never bundled — while still returning the genuine
 * Node.js builtin at runtime (Node 22+ / `runtime = 'nodejs'`).
 *
 * Tests mock THIS module (see source-ingest.test.ts), not `node:child_process`,
 * because `getBuiltinModule` bypasses the require cache that `jest.mock` hooks.
 */

import type { execFile as ExecFileType } from 'node:child_process'

/**
 * Returns the real `child_process.execFile` via the bundler-opaque
 * `process.getBuiltinModule`. Throws if invoked in a runtime without builtin
 * module access (e.g. Edge) — callers already require the Node.js runtime.
 */
export function getExecFile(): typeof ExecFileType {
  const cp = process.getBuiltinModule('node:child_process')
  return cp.execFile
}
