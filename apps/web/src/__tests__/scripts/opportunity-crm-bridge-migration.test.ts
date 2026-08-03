import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migration = read('20260801140000_add_opportunity_crm_bridge.sql')
const rollback = read('20260801140000_add_opportunity_crm_bridge.down.sql')
const claimsMigration = read('20260802100000_add_opportunity_crm_delivery_claims.sql')
const claimsRollback = read('20260802100000_add_opportunity_crm_delivery_claims.down.sql')
const compact = migration.replace(/\s+/g, ' ')
const downVerifier = readScript('verify-opportunity-engine-down.mjs')

describe('Opportunity CRM bridge migration contract', () => {
  it('creates workspace-bound integrations and one active credential', () => {
    expect(migration).toContain('CREATE TABLE opportunity_crm_integrations')
    expect(migration).toContain('CREATE TABLE opportunity_crm_credentials')
    expect(compact).toContain(
      'FOREIGN KEY (integration_id, workspace_id) REFERENCES opportunity_crm_integrations(id, workspace_id)',
    )
    expect(migration).toContain('opportunity_crm_credentials_one_active_uidx')
    expect(migration).toContain("WHERE status = 'active'")
  })

  it('stores only a validated hash and bounded callback policy', () => {
    expect(migration).toContain('secret_hash CHAR(64) NOT NULL')
    expect(migration).toContain("secret_hash ~ '^[a-f0-9]{64}$'")
    expect(migration).not.toMatch(/secret_plaintext|raw_secret|access_token/i)
    expect(migration).toContain('allowed_event_types TEXT[] NOT NULL')
    expect(migration).toContain('rate_limit_max_requests INTEGER NOT NULL')
    expect(migration).toContain('rate_limit_window_seconds INTEGER NOT NULL')
    expect(migration).toContain('replay_window_seconds INTEGER NOT NULL')
  })

  it('adds durable replay receipts and outbound delivery audit', () => {
    expect(migration).toContain('CREATE TABLE opportunity_crm_callback_receipts')
    expect(migration).toContain('CREATE TABLE opportunity_crm_deliveries')
    expect(migration).toContain('external_event_id TEXT NOT NULL')
    expect(migration).toContain('request_hash CHAR(64) NOT NULL')
    expect(migration).toContain('UNIQUE (credential_id, external_event_id)')
    expect(compact).toContain(
      'FOREIGN KEY (credential_id, integration_id, workspace_id) REFERENCES opportunity_crm_credentials(id, integration_id, workspace_id)',
    )
    expect(migration).toContain('response_code TEXT NOT NULL')
    expect(migration).toContain('credential_id BIGINT NOT NULL')
    expect(migration).toContain('opportunity_crm_callback_receipts_append_only')
  })

  it('preserves audit state by refusing a non-empty rollback', () => {
    expect(rollback).toContain('opportunity CRM bridge rollback refused')
    expect(rollback).toContain('opportunity_crm_callback_receipts')
    expect(rollback).toContain('opportunity_crm_deliveries')
    expect(rollback).toContain('opportunity_crm_credentials')
    expect(downVerifier).toContain(
      '20260803120000_add_company_events_v1.down.sql',
    )
    expect(downVerifier).toContain(
      '20260802100000_add_opportunity_crm_delivery_claims.down.sql',
    )
    expect(downVerifier).toContain(
      '20260801140000_add_opportunity_crm_bridge.down.sql',
    )
    expect(downVerifier).toContain('PRE_FIXTURE_DOWN_MIGRATIONS = 12')
  })

  it('coordinates outbound delivery without keeping the audit ledger mutable', () => {
    expect(claimsMigration).toContain('CREATE TABLE opportunity_crm_delivery_claims')
    expect(claimsMigration).toContain('event_id UUID PRIMARY KEY')
    expect(claimsMigration).toContain('claim_token UUID NOT NULL')
    expect(claimsMigration).toContain('request_body TEXT NOT NULL')
    expect(claimsMigration).toContain('request_timestamp CHAR(10) NOT NULL')
    expect(claimsMigration).toContain('opportunity_crm_delivery_claims_stale_idx')
    expect(claimsRollback).toContain('active claims exist')
    expect(claimsRollback.indexOf('LOCK TABLE opportunity_crm_delivery_claims'))
      .toBeLessThan(claimsRollback.indexOf('IF EXISTS'))
  })
})

function read(name: string) {
  return readFileSync(resolve(
    process.cwd(), '..', '..', 'packages', 'db', 'migrations', name,
  ), 'utf8')
}

function readScript(name: string) {
  return readFileSync(resolve(
    process.cwd(), '..', '..', 'packages', 'db', 'scripts', name,
  ), 'utf8')
}
