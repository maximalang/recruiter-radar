import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  GOLD_SET_EXPORT_MAX_ELIGIBLE_ROWS,
  loadCommercialSignalGoldSetRows,
} from './commercial-signal-gold-set-export-v1.mjs'

const scope = {
  workspaceId: '101',
  profileId: '202',
  from: '2026-07-01T00:00:00.000Z',
  to: '2026-08-01T00:00:00.000Z',
}

test('export query is exact workspace/profile/time scoped and PII-minimized', async () => {
  let captured = null
  const client = {
    async query(sql, params) {
      captured = { sql, params }
      return { rows: [] }
    },
  }
  const rows = await loadCommercialSignalGoldSetRows(client, scope)
  assert.deepEqual(rows, [])
  assert.deepEqual(captured.params, [scope.workspaceId, scope.profileId, scope.from, scope.to])
  assert.match(captured.sql, /quality\.workspace_id = \$1::BIGINT/)
  assert.match(captured.sql, /quality\.client_profile_id = \$2::BIGINT/)
  assert.match(captured.sql, /quality\.decision_at >= \$3::TIMESTAMPTZ/)
  assert.match(captured.sql, /quality\.decision_at < \$4::TIMESTAMPTZ/)
  assert.match(captured.sql, /profile\.workspace_id = quality\.workspace_id/)
  assert.match(captured.sql, /item\.workspace_id = quality\.workspace_id/)
  assert.match(captured.sql, /item\.client_profile_id = quality\.client_profile_id/)
  assert.match(captured.sql, new RegExp(`LIMIT ${GOLD_SET_EXPORT_MAX_ELIGIBLE_ROWS + 1}`))
  assert.doesNotMatch(captured.sql, /source_domain|canonical_url/i)
  assert.doesNotMatch(captured.sql, /email|phone|telegram|token|secret|password/i)
})

test('CLI requires explicit scope/version/sampling and opens a read-only transaction', async () => {
  const scriptPath = fileURLToPath(new URL('../export-commercial-signal-gold-set-v1.mjs', import.meta.url))
  const source = await fs.readFile(scriptPath, 'utf8')
  for (const flag of [
    '--workspace-id', '--profile-id', '--from', '--to', '--dataset-version',
    '--sampling-policy', '--seed', '--output-dir',
  ]) {
    assert.match(source, new RegExp(`required\\('${flag}'\\)`))
  }
  assert.match(source, /BEGIN TRANSACTION READ ONLY/)
  assert.match(source, /EVALUATION_ANONYMIZATION_KEY/)
  assert.match(source, /Output directory already exists/)
  assert.doesNotMatch(source, /UPDATE\s|INSERT\s|DELETE\s/i)
})
