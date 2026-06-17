#!/usr/bin/env node
/**
 * Guard: `apps/web/src/app/` must not exist.
 *
 * WHY: Next.js resolves the App Router from EITHER `app/` or `src/app/`. When
 * both exist it silently uses `app/` and ignores `src/app/` entirely — routes
 * placed under `src/app/` build without error but 404 at runtime. This exact
 * trap shipped a pre-relocation deploy where /api/cron/daily-radar 404'd while
 * /api/health (in app/) served 200. Fail the build if src/app/ ever returns.
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const forbidden = resolve(repoRoot, 'apps/web/src/app')

if (existsSync(forbidden)) {
  console.error(
    '\n✖ Router shadowing guard FAILED\n' +
      `  Found: apps/web/src/app/\n\n` +
      '  Next.js uses apps/web/app/ and SILENTLY IGNORES apps/web/src/app/ when\n' +
      '  both exist. Routes under src/app/ build cleanly but 404 in production.\n' +
      '  Move every route/page into apps/web/app/ and delete apps/web/src/app/.\n'
  )
  process.exit(1)
}

console.log('✓ Router guard OK — no apps/web/src/app/ shadowing apps/web/app/')
