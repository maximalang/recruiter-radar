import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DIGEST_EVIDENCE_QUERY } from '@/lib/digest-evidence-query'

// Guards against drift between the canonical SQL file and the inlined TS mirror.
// The mirror exists because Next.js's standalone tracer cannot bundle a file read
// via a dynamic readFileSync path. If this fails, re-run
// scripts/sync-digest-evidence-query.mjs after editing the .sql.
describe('digest evidence query mirror', () => {
  it('matches packages/db/scripts/source-digest-evidence.sql byte-for-byte', () => {
    const sqlPath = resolve(__dirname, '../../../../../packages/db/scripts/source-digest-evidence.sql')
    const canonical = readFileSync(sqlPath, 'utf8')
    expect(DIGEST_EVIDENCE_QUERY).toBe(canonical)
  })
})
