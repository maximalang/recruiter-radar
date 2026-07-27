import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migrationPath = resolve(
  process.cwd(),
  '..',
  '..',
  'packages',
  'db',
  'migrations',
  '20260726130000_add_opportunity_engine_v1.sql',
)
const rollbackPath = resolve(
  process.cwd(),
  '..',
  '..',
  'packages',
  'db',
  'migrations',
  '20260726130000_add_opportunity_engine_v1.down.sql',
)
const hardeningMigrationPath = resolve(
  process.cwd(),
  '..',
  '..',
  'packages',
  'db',
  'migrations',
  '20260727120000_add_opportunity_engine_hardening.sql',
)
const episodeStateMigrationPath = resolve(
  process.cwd(),
  '..',
  '..',
  'packages',
  'db',
  'migrations',
  '20260727121000_add_opportunity_episode_state.sql',
)
const supersessionMigrationPath = resolve(
  process.cwd(),
  '..',
  '..',
  'packages',
  'db',
  'migrations',
  '20260727122000_add_opportunity_supersession.sql',
)
const supersessionRollbackPath = resolve(
  process.cwd(),
  '..',
  '..',
  'packages',
  'db',
  'migrations',
  '20260727122000_add_opportunity_supersession.down.sql',
)

describe('opportunity engine migration contract', () => {
  const migration = readFileSync(migrationPath, 'utf8')
  const rollback = readFileSync(rollbackPath, 'utf8')
  const compactMigration = migration.replace(/\s+/g, ' ')

  it('adds the episode, evidence, opportunity, and action tables', () => {
    for (const table of [
      'hiring_episodes',
      'hiring_episode_evidence',
      'hiring_episode_detection_state',
      'opportunities',
      'opportunity_actions',
      'opportunity_build_failures',
    ]) {
      expect(migration).toMatch(new RegExp(`CREATE TABLE ${table}\\b`))
    }
  })

  it('enforces source references and tenant ownership at the database boundary', () => {
    expect(compactMigration).toContain('last_signal_id BIGINT NOT NULL')
    expect(compactMigration).toContain(
      'last_signal_updated_at TIMESTAMPTZ NOT NULL',
    )
    expect(compactMigration).toContain(
      'CREATE INDEX opportunities_organization_status_idx',
    )
    expect(compactMigration).toContain('REFERENCES orgs(id)')
    expect(compactMigration).toContain('REFERENCES signals(id, org_id)')
    expect(compactMigration).toContain('REFERENCES evidence_items(id, org_id)')
    expect(compactMigration).toContain('FOREIGN KEY (client_profile_id, owner_id)')
    expect(compactMigration).toContain('REFERENCES client_profiles(id, owner_id)')
    expect(compactMigration).toContain('FOREIGN KEY (opportunity_id, owner_id)')
    expect(compactMigration).toContain('REFERENCES opportunities(id, owner_id)')
  })

  it('constrains scores, lifecycle values, evidence hashes, and idempotency keys', () => {
    expect(compactMigration).toContain("status IN ('active', 'closed')")
    expect(compactMigration).toMatch(
      /status IN \( 'new', 'review', 'accepted', 'dismissed', 'snoozed', 'contacted', 'expired' \)/,
    )
    expect(compactMigration).toContain("confidence_gate IN ('A', 'B', 'C', 'D')")
    expect(compactMigration).toMatch(/opportunity_score BETWEEN 0 AND 1/)
    expect(compactMigration).toContain(
      'valid_until IS NULL OR valid_until >= valid_from',
    )
    expect(compactMigration).toMatch(/strength_score BETWEEN 0 AND 1/)
    expect(compactMigration).toContain("evidence_hash ~ '^[a-f0-9]{64}$'")
    expect(compactMigration).toContain(
      'UNIQUE (client_profile_id, hiring_episode_id, scoring_version)',
    )
    expect(compactMigration).toContain('UNIQUE (opportunity_id, action_key)')
    expect(compactMigration).toContain(
      "action_fingerprint ~ '^[a-f0-9]{64}$'",
    )
  })

  it('adds operational indexes and remains additive without an implicit backfill', () => {
    expect(migration).toContain('hiring_episodes_active_last_seen_idx')
    expect(migration).toContain('hiring_episodes_status_idx')
    expect(migration).toContain('hiring_episodes_started_at_idx')
    expect(migration).toContain('hiring_episodes_last_seen_at_idx')
    expect(migration).toContain('hiring_episodes_episode_type_idx')
    expect(migration).toContain('opportunities_owner_status_score_idx')
    expect(migration).toContain('opportunities_episode_idx')
    expect(migration).toContain('opportunities_organization_status_idx')
    expect(migration).toContain('opportunity_build_failures_retry_idx')
    expect(migration).toContain('opportunity_build_failures_episode_idx')
    expect(migration).toContain('digest_candidates_client_profile_org_created_idx')
    expect(migration).toContain('hiring_episode_evidence_signal_lookup_idx')
    expect(migration).toContain('hiring_episode_evidence_item_lookup_idx')
    expect(migration).not.toMatch(/INSERT\s+INTO\s+(hiring_episodes|opportunities)/i)
    expect(migration).not.toMatch(/ALTER\s+TYPE\s+signal_kind/i)
  })

  it('ships an explicit reverse-order rollback', () => {
    expect(
      rollback.indexOf('DROP TABLE IF EXISTS opportunity_build_failures'),
    ).toBeLessThan(
      rollback.indexOf('DROP TABLE IF EXISTS opportunity_actions'),
    )
    expect(rollback.indexOf('DROP TABLE IF EXISTS opportunity_actions')).toBeLessThan(
      rollback.indexOf('DROP TABLE IF EXISTS opportunities'),
    )
    expect(rollback.indexOf('DROP TABLE IF EXISTS opportunities')).toBeLessThan(
      rollback.indexOf('DROP TABLE IF EXISTS hiring_episode_evidence'),
    )
    expect(rollback.indexOf('DROP TABLE IF EXISTS hiring_episode_evidence')).toBeLessThan(
      rollback.indexOf('DROP TABLE IF EXISTS hiring_episodes'),
    )
  })
})

describe('opportunity engine hardening migrations', () => {
  const hardening = readFileSync(hardeningMigrationPath, 'utf8').replace(/\s+/g, ' ')
  const episodeState = readFileSync(episodeStateMigrationPath, 'utf8').replace(/\s+/g, ' ')
  const supersession = readFileSync(supersessionMigrationPath, 'utf8').replace(/\s+/g, ' ')
  const supersessionRollback = readFileSync(
    supersessionRollbackPath,
    'utf8',
  ).replace(/\s+/g, ' ')

  it('adds stable episode identity and safely renames role_cluster', () => {
    expect(hardening).toContain('episode_identity TEXT')
    expect(hardening).toContain('episode_generation INTEGER')
    expect(hardening).toContain("episode_type = 'role_cluster'")
    expect(hardening).toContain("'^new_role_cluster:'")
    expect(hardening).toContain('hiring_episodes_identity_generation_uidx')
    expect(hardening).toContain('input_fingerprint TEXT')
    expect(hardening.indexOf('DROP CONSTRAINT hiring_episodes_type_check')).toBeLessThan(
      hardening.indexOf("episode_type = 'role_cluster'"),
    )
  })

  it('adds tenant-safe episode state and transition audit columns', () => {
    expect(episodeState).toContain('CREATE TABLE client_episode_state')
    expect(episodeState).toContain('FOREIGN KEY (client_profile_id, owner_id)')
    expect(episodeState).toContain('FOREIGN KEY (hiring_episode_id, organization_id)')
    expect(episodeState).toContain('previous_status')
    expect(episodeState).toContain('new_status')
  })

  it('adds current-version uniqueness and deterministic provenance', () => {
    expect(supersession).toContain('superseded_at TIMESTAMPTZ')
    expect(supersession).toContain('opportunities_current_uidx')
    expect(supersession).toContain('WITH ranked_current AS')
    expect(supersession).toContain('current_rank > 1')
    expect(supersession).toContain(
      'ON digest_candidates ( client_profile_id, org_id, created_at DESC, id DESC ) INCLUDE (digest_run_id)',
    )
    for (const column of [
      'episode_evidence_hash',
      'profile_snapshot_hash',
      'digest_candidate_id',
      'fiur_version',
      'scoring_config_hash',
      'brief_builder_version',
      'input_hash',
    ]) {
      expect(supersession).toContain(column)
    }
  })

  it('preserves action audit records when supersession is rolled back', () => {
    expect(supersessionRollback).toContain('UPDATE opportunity_actions action')
    expect(supersessionRollback).toContain('rollbackOriginalOpportunityId')
    expect(supersessionRollback.indexOf('UPDATE opportunity_actions action')).toBeLessThan(
      supersessionRollback.indexOf('DELETE FROM opportunities'),
    )
  })
})
