import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  DIGEST_SUPPRESSION_EXCLUSION_SQL,
  getSuppressionScopeSnapshot,
} from '@/lib/orgSuppression'

const root = resolve(__dirname, '../../../../..')
const readRoot = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('cross-fragment organization suppression contract', () => {
  it('resolves the target key and every ER-equivalent org from the canonical DB view', async () => {
    const db = {
      query: jest.fn().mockResolvedValue({
        rows: [{ suppressionKey: 'inn:7701234567', suppressedOrgIds: ['42', '77'] }],
        rowCount: 1,
      }),
    }

    const scope = await getSuppressionScopeSnapshot(db as never, '42')

    expect(scope).toEqual({
      suppressionKey: 'inn:7701234567',
      suppressedOrgIds: ['42', '77'],
    })
    const sql = db.query.mock.calls[0][0] as string
    expect(sql).toContain('org_corroboration_keys_v1')
    expect(sql).toMatch(/target_key[\s\S]+corroboration_key[\s\S]+target_key/i)
    expect(sql).not.toMatch(/WHERE\s+corb\.org_id\s*=\s*\$1/i)
  })

  it('defines the canonical ER-key view in both migration and bootstrap schema', () => {
    const migration = readRoot('packages/db/migrations/20260828100000_add_client_org_suppressions.sql')
    const schema = readRoot('packages/db/schema/init.sql')
    const evidenceQuery = readRoot('packages/db/scripts/source-digest-evidence.sql')

    expect(migration).toMatch(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+org_corroboration_keys_v1/i)
    expect(schema).toMatch(/CREATE\s+VIEW\s+org_corroboration_keys_v1/i)
    expect(evidenceQuery).toContain('FROM org_corroboration_keys_v1')
  })

  it('records the exact feedback event instead of a nonexistent state surrogate id', () => {
    const migration = readRoot('packages/db/migrations/20260828100000_add_client_org_suppressions.sql')
    const schema = readRoot('packages/db/schema/init.sql')

    for (const sql of [migration, schema]) {
      expect(sql).toContain('source_digest_candidate_id BIGINT')
      expect(sql).toContain('source_feedback_at TIMESTAMPTZ NOT NULL')
      expect(sql).not.toContain('source_client_digest_org_state_id')
    }
  })

  it('filters suppression inside both candidate queries before LIMIT', () => {
    const digestSource = readRoot('apps/web/lib/digest.ts')
    const injections = digestSource.match(/\$\{DIGEST_SUPPRESSION_EXCLUSION_SQL\}/g) ?? []

    expect(DIGEST_SUPPRESSION_EXCLUSION_SQL).toContain('ranked_candidates.corroboration_key')
    expect(injections).toHaveLength(2)
    expect(digestSource).not.toContain('loadActiveSuppressedOrgIds')
  })

  it('provides a real rollback for the additive suppression objects', () => {
    const rollback = readRoot('packages/db/migrations/20260828100000_add_client_org_suppressions.down.sql')

    expect(rollback).toMatch(/DROP\s+TABLE\s+IF\s+EXISTS\s+client_org_suppressions/i)
    expect(rollback).toMatch(/DROP\s+VIEW\s+IF\s+EXISTS\s+org_corroboration_keys_v1/i)
  })
})