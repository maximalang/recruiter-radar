#!/usr/bin/env node
// Regenerates apps/web/lib/digest-evidence-query.ts from the canonical
// packages/db/scripts/source-digest-evidence.sql. Run after editing the .sql.
//
// The query is inlined as a TS String.raw constant rather than read at runtime
// because Next.js's standalone output tracer cannot follow a dynamic
// readFileSync path, so the .sql would never be bundled. Drift between the two
// is caught by src/__tests__/lib/digest-evidence-query.test.ts, which compares
// the inlined constant against the .sql byte-for-byte.
//
// Run with --check to verify the mirror is in sync without writing (exit 1 on
// drift) — suitable for CI / pre-commit.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = resolve(here, '../../../packages/db/scripts/source-digest-evidence.sql')
const outPath = resolve(here, '../lib/digest-evidence-query.ts')

// Normalize CRLF -> LF. JS template literals (including String.raw) collapse
// CRLF to LF at evaluation, so the runtime DIGEST_EVIDENCE_QUERY is always LF.
// On a Windows checkout with core.autocrlf=true the .sql lands on disk as CRLF;
// inlining it verbatim would make the byte-for-byte drift test (which reads the
// .sql back) compare CRLF-on-disk against the LF constant and fail. Emitting LF
// keeps the mirror identical to what JS produces. (.gitattributes also pins both
// files to eol=lf; this is the belt to that suspenders.)
const sql = readFileSync(sqlPath, 'utf8').replace(/\r\n/g, '\n')

// String.raw stops escaping, but an unescaped backtick or ${ inside the SQL
// would still terminate the template / start an interpolation. The SQL must
// not contain either; fail loudly rather than emit a broken mirror.
if (sql.includes('`') || sql.includes('${')) {
  console.error(
    `Cannot inline ${sqlPath}: contains a backtick or \${ ` +
      'which String.raw cannot safely escape. Rework the SQL or the inlining strategy.',
  )
  process.exit(1)
}

const header =
  '// AUTO-MIRRORED from packages/db/scripts/source-digest-evidence.sql.\n' +
  '// Inlined so Next.js bundles it (the standalone tracer cannot follow a dynamic\n' +
  '// readFileSync path, and import.meta.url is unsafe in the bundled runtime).\n' +
  '// String.raw preserves SQL regex escapes (s+) verbatim. Drift is guarded by\n' +
  '// digest-evidence-query.test.ts. Edit the .sql file, then re-run scripts/sync-digest-evidence-query.mjs.\n\n'

const generated = `${header}export const DIGEST_EVIDENCE_QUERY = String.raw\`${sql}\`;\n`

const checkOnly = process.argv.includes('--check')
let current = null
try {
  current = readFileSync(outPath, 'utf8')
} catch {
  // missing mirror — will be created (or, in --check, reported as drift)
}

if (current === generated) {
  console.log(`Mirror already in sync (${sql.length} chars of SQL).`)
  process.exit(0)
}

if (checkOnly) {
  console.error(
    `Mirror out of sync with ${sqlPath}.\n` +
      'Run: node apps/web/scripts/sync-digest-evidence-query.mjs',
  )
  process.exit(1)
}

writeFileSync(outPath, generated)
console.log(`Synced ${outPath} (${sql.length} chars of SQL).`)
