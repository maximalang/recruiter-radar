import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../../../../..')
const migration = fs.readFileSync(path.join(
  root,
  'packages/db/migrations/20260804160000_add_query_planner_v2.sql',
), 'utf8')
const rollback = fs.readFileSync(path.join(
  root,
  'packages/db/migrations/20260804160000_add_query_planner_v2.down.sql',
), 'utf8')
const rootPackage = fs.readFileSync(path.join(root, 'package.json'), 'utf8')
const workflow = fs.readFileSync(path.join(root, '.github/workflows/test.yml'), 'utf8')
const dbRunner = fs.readFileSync(path.join(
  root,
  'packages/db/scripts/run-query-planner-v2-db-tests.mjs',
), 'utf8')
const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8')
const plannerJob = fs.readFileSync(path.join(
  root,
  'apps/web/lib/lead-discovery/query-planner-v2-job.ts',
), 'utf8')
const sourceExecutor = fs.readFileSync(path.join(
  root,
  'packages/db/scripts/execute-query-planner-v2.mjs',
), 'utf8')
const productionDockerfile = fs.readFileSync(path.join(
  root,
  'apps/web/Dockerfile',
), 'utf8')
const plannerDocs = fs.readFileSync(path.join(
  root,
  'docs/query-planner-v2.md',
), 'utf8')
const canaryRunbook = fs.readFileSync(path.join(
  root,
  'docs/commercial-signal-production-canary.md',
), 'utf8')
const downVerifier = fs.readFileSync(path.join(
  root,
  'packages/db/scripts/verify-opportunity-engine-down.mjs',
), 'utf8')
const ancestorVerifiers = [
  'verify-company-events-v1.mjs',
  'verify-company-state-v1.mjs',
  'verify-signal-episodes-v2.mjs',
  'verify-commercial-theses-v1.mjs',
  'verify-external-agency-propensity-v1.mjs',
  'verify-agency-dna-match-v2.mjs',
  'verify-opportunity-scoring-v3.mjs',
].map((name) => fs.readFileSync(path.join(
  root,
  'packages/db/scripts',
  name,
), 'utf8'))

describe('Query Planner v2 migration', () => {
  it('adds append-only plans, shared requests, consumers, and metrics', () => {
    for (const table of [
      'query_plan_snapshots',
      'query_plan_shared_requests',
      'query_plan_request_consumers',
      'query_plan_metric_snapshots',
    ]) {
      expect(migration).toMatch(new RegExp(`CREATE TABLE ${table}\\b`))
      expect(migration).toContain(`BEFORE UPDATE OR DELETE ON ${table}`)
    }
    expect(migration).not.toMatch(/ALTER TABLE (signals|opportunities|digest_candidates)\b/)
  })

  it('stores every required profile-scoped plan dimension and provenance hash', () => {
    for (const field of [
      'workspace_id BIGINT NOT NULL',
      'owner_id BIGINT NOT NULL',
      'client_profile_id BIGINT NOT NULL',
      'source TEXT NOT NULL',
      'role_family TEXT NOT NULL',
      'role_synonyms TEXT[] NOT NULL',
      'specializations TEXT[] NOT NULL',
      'canonical_region TEXT',
      'region_snapshot JSONB NOT NULL',
      'seniorities TEXT[] NOT NULL',
      'keyword_cluster TEXT[] NOT NULL',
      'negative_terms TEXT[] NOT NULL',
      'page_budget INTEGER NOT NULL',
      'frequency TEXT NOT NULL',
      'profile_consumers BIGINT[] NOT NULL',
      'historical_yield JSONB NOT NULL',
      'feedback_adjustments JSONB NOT NULL',
      'query_env JSONB NOT NULL',
      'profile_snapshot_hash TEXT NOT NULL',
      'feedback_hash TEXT NOT NULL',
      'shared_request_hash TEXT NOT NULL',
      'input_hash TEXT NOT NULL',
    ]) {
      expect(migration).toContain(field)
    }
  })

  it('binds plans and metrics to exact tenant-scoped profiles', () => {
    expect(migration).toContain('query_plan_snapshots_profile_scope_fkey')
    expect(migration).toContain(
      'REFERENCES client_profiles(id, owner_id, workspace_id)',
    )
    expect(migration).toContain('query_plan_request_consumers_plan_scope_fkey')
    expect(migration).toContain('query_plan_metric_snapshots_plan_scope_fkey')
    expect(migration).toContain(
      'profile_consumers = ARRAY[client_profile_id]::BIGINT[]',
    )
    expect(migration).toContain('validate_query_plan_consumer_request')
    expect(migration).toContain('HASHTEXTEXTENDED(')
  })

  it('keeps shared fetch identity separate from per-profile exclusions and feedback', () => {
    expect(migration).toContain('UNIQUE (planner_version, source, shared_request_hash)')
    expect(migration).toContain('negative_terms TEXT[] NOT NULL')
    expect(migration).toContain('feedback_adjustments JSONB NOT NULL')
    expect(migration).toContain('profile_consumers BIGINT[] NOT NULL')
    expect(migration).toContain('query_plan_request_consumers_profile_unique')
  })

  it('stores the complete query-plan metric contract with nullable rates', () => {
    for (const field of [
      'fetched_records BIGINT',
      'unique_events BIGINT',
      'unique_companies BIGINT',
      'episodes BIGINT',
      'qualified_opportunities BIGINT',
      'accepted BIGINT',
      'contacted BIGINT',
      'replied BIGINT',
      'meetings BIGINT',
      'duplicate_rate NUMERIC(8, 7)',
      'zero_result_rate NUMERIC(8, 7)',
    ]) {
      expect(migration).toContain(field)
    }
    expect(migration).toContain('query_plan_metric_rates_valid')
  })

  it('refuses lossy rollback and preserves Opportunity Scoring v3', () => {
    expect(rollback).toContain(
      'LOCK TABLE query_plan_snapshots IN ACCESS EXCLUSIVE MODE',
    )
    expect(rollback).toContain('query planner v2 rollback refused')
    expect(rollback).not.toContain('DROP TABLE opportunity_candidates')
    expect(rollback.indexOf('DROP TABLE query_plan_metric_snapshots'))
      .toBeLessThan(rollback.indexOf('DROP TABLE query_plan_snapshots'))
  })

  it('runs its isolated PostgreSQL gate after Opportunity Scoring v3', () => {
    expect(rootPackage).toContain('"test:query-planner-v2:db"')
    const parentGate = workflow.indexOf(
      'run: npm run test:opportunity-scoring-v3:db',
    )
    const plannerGate = workflow.indexOf(
      'run: npm run test:query-planner-v2:db',
    )
    expect(parentGate).toBeGreaterThan(-1)
    expect(plannerGate).toBeGreaterThan(parentGate)
    expect(dbRunner).toContain('query-planner-v2-repository.test.ts')
    expect(dbRunner).toContain('query-planner-v2-runtime-db.test.ts')
  })

  it('keeps the job dark and feedback reads profile scoped', () => {
    expect(envExample).toContain('QUERY_PLANNER_V2_ENABLED=false')
    expect(plannerJob).toContain('state.client_profile_id = profile.id')
    expect(plannerJob).toContain('preference.user_id = profile.owner_id')
    expect(plannerDocs).toContain('does not switch the')
    expect(plannerDocs).toContain('apply=true')
  })

  it('keeps unapproved source dependencies out of the canary startup path', () => {
    expect(sourceExecutor).not.toMatch(
      /^import[\s\S]*?from ['"]\.\/adapters\/hh\.mjs['"];?$/m,
    )
    expect(sourceExecutor).toContain("await import('./adapters/hh.mjs')")
    expect(productionDockerfile).toContain(
      "await import('./packages/db/scripts/execute-query-planner-v2.mjs')",
    )
    expect(productionDockerfile).toContain(
      "await import('./packages/db/scripts/adapters/hh.mjs')",
    )
    for (const dependency of ['socks', 'ip-address', 'smart-buffer', 'undici']) {
      expect(productionDockerfile).toContain(
        `/app/node_modules/${dependency} ./node_modules/${dependency}`,
      )
    }
  })

  it('serializes production canary mutation with the deployment lock', () => {
    expect(canaryRunbook).toContain('/tmp/recruiter-radar-deployment.lock')
    expect(canaryRunbook).toContain('flock -n 9')
    expect(canaryRunbook).toContain('do not start another canary')
    expect(canaryRunbook).toContain('receipt is archived and the runtime is dark')
  })

  it('rolls the child schema down before every ancestor', () => {
    for (const verifier of ancestorVerifiers) {
      const child = verifier.indexOf('database.query(queryPlannerV2DownSql)')
      const namedParent = verifier.indexOf(
        'database.query(opportunityScoringV3DownSql)',
      )
      const parent = namedParent > -1
        ? namedParent
        : verifier.indexOf('database.query(downSql)', child)
      expect(child).toBeGreaterThan(-1)
      expect(parent).toBeGreaterThan(child)
    }
    const childDown = downVerifier.indexOf(
      "'20260804160000_add_query_planner_v2.down.sql'",
    )
    const parentDown = downVerifier.indexOf(
      "'20260804150000_add_opportunity_candidates_v3.down.sql'",
    )
    expect(childDown).toBeGreaterThan(-1)
    expect(parentDown).toBeGreaterThan(childDown)
    expect(downVerifier).toContain('PRE_FIXTURE_DOWN_MIGRATIONS = 25')
  })
})
