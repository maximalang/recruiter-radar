import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../../../../..')
const migration = fs.readFileSync(path.join(
  root,
  'packages/db/migrations/20260810120000_isolate_user_search_preferences.sql',
), 'utf8')
const rollback = fs.readFileSync(path.join(
  root,
  'packages/db/migrations/20260810120000_isolate_user_search_preferences.down.sql',
), 'utf8')
const plannerJob = fs.readFileSync(path.join(
  root,
  'apps/web/lib/lead-discovery/query-planner-v2-job.ts',
), 'utf8')
const sharedIngest = fs.readFileSync(path.join(
  root,
  'apps/web/lib/lead-discovery/source-ingest.ts',
), 'utf8')

describe('Search Preferences Isolation', () => {
  it('makes workspace ownership part of preference identity', () => {
    expect(migration).toContain('ALTER COLUMN workspace_id SET NOT NULL')
    expect(migration).toContain(
      'PRIMARY KEY (workspace_id, user_id, source)',
    )
    expect(migration).toContain(
      'SET workspace_id = ensure_auth_user_workspace(preference.user_id)',
    )
  })

  it('namespaces tenant preferences away from raw shared-ingestion source ids', () => {
    expect(migration).toContain("SET source = 'planner:' || source")
    expect(migration).toContain('user_search_preferences_planner_namespace')
    expect(migration).toContain("source LIKE 'planner:%'")
    expect(sharedIngest).toContain('WHERE source = $1')
    expect(sharedIngest).not.toContain("'planner:'")
  })

  it('loads Query Planner overrides from the exact workspace and owner only', () => {
    expect(plannerJob).toContain(
      'preference.workspace_id = profile.workspace_id',
    )
    expect(plannerJob).toContain('preference.user_id = profile.owner_id')
    expect(plannerJob).toContain("preference.source LIKE 'planner:%'")
    expect(plannerJob).toContain(
      'SUBSTRING(preference.source FROM 9) = ANY($3::TEXT[])',
    )
    expect(plannerJob).toContain(
      'SUBSTRING(preference.source FROM 9),',
    )
  })

  it('refuses a lossy rollback when legacy identity cannot represent the rows', () => {
    expect(rollback).toContain('LOCK TABLE user_search_preferences IN ACCESS EXCLUSIVE MODE')
    expect(rollback).toContain('GROUP BY user_id, SUBSTRING(source FROM 9)')
    expect(rollback).toContain(
      'search preference isolation rollback refused: multi-workspace preferences would collide',
    )
    expect(rollback).toContain('PRIMARY KEY (user_id, source)')
    expect(rollback).not.toContain('DROP TABLE user_search_preferences')
  })
})
