import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../../../../..')
const up = fs.readFileSync(path.join(root, 'packages/db/migrations/20260814030000_add_source_temporal_health.sql'), 'utf8')
const down = fs.readFileSync(path.join(root, 'packages/db/migrations/20260814030000_add_source_temporal_health.down.sql'), 'utf8')
const dockerfile = fs.readFileSync(path.join(root, 'apps/web/Dockerfile'), 'utf8')

test('adds append-only source health and temporal transition storage', () => {
  for (const table of ['source_run_observations', 'source_health_state', 'source_temporal_observations', 'source_temporal_derived_events']) expect(up).toContain(`CREATE TABLE ${table}`)
  for (const metric of ['last_successful_fetch_at', 'last_successful_normalization_at', 'duplicate_records', 'organization_resolution_rejects', 'blocked_count', 'rate_limited_count', 'extraction_methods', 'latency_ms', 'consecutive_failures']) expect(up).toContain(metric)
  expect(up).toContain("window_days IN (7, 14, 30)")
  expect(down).toContain('DROP TABLE IF EXISTS source_run_observations')
})

test('ships the scheduled temporal derivation and its pure dependency in the production image', () => {
  expect(dockerfile).toContain('COPY --from=builder /app/packages/db/scripts/derive-source-temporal-intelligence.mjs')
  expect(dockerfile).toContain('COPY --from=builder /app/packages/db/scripts/lib/source-temporal-intelligence.mjs')
  expect(dockerfile).toContain("await import('./packages/db/scripts/derive-source-temporal-intelligence.mjs')")
})
