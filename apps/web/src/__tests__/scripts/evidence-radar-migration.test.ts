import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { NORMALIZED_SIGNAL_TYPES } from '@/lib/intelligence/evidence-radar'
import { SOURCE_REGISTRY } from '@/lib/intelligence/source-registry'

const migrationDir = resolve(process.cwd(), '..', '..', 'packages', 'db', 'migrations')
const names = [
  '20260807100000_add_evidence_source_registry_v1',
  '20260807101000_add_evidence_organization_identity_v1',
  '20260807102000_add_evidence_events_signals_v1',
  '20260807103000_add_evidence_lead_cards_v1',
  '20260807104000_harden_evidence_lead_qualification_v1',
] as const
const destructiveDataMigrationNames = names.slice(0, 4)

const up = Object.fromEntries(names.map((name) => [
  name,
  readFileSync(resolve(migrationDir, `${name}.sql`), 'utf8'),
])) as Record<(typeof names)[number], string>
const down = Object.fromEntries(names.map((name) => [
  name,
  readFileSync(resolve(migrationDir, `${name}.down.sql`), 'utf8'),
])) as Record<(typeof names)[number], string>

const compact = (value: string) => value.replace(/\s+/g, ' ')

describe('Evidence Radar v1 migration contract', () => {
  it('seeds the TypeScript Source Registry and fails closed before legal approval', () => {
    const migration = up[names[0]]
    for (const source of SOURCE_REGISTRY) {
      expect(migration).toContain(`('${source.id}'`)
    }
    expect(migration).toContain('CREATE TABLE source_registry_reviews_v1')
    expect(migration).toContain('authorization_method TEXT NOT NULL')
    expect(migration).not.toContain('\n  authorization TEXT NOT NULL')
    expect(migration).toContain('evidence_radar_source_allowed_v1')
    expect(migration).toContain("'first-party-crm', 'not_applicable'")
  })

  it('allows governed source-policy updates only through an audited history boundary', () => {
    const migration = up[names[0]]
    expect(migration).toContain('CREATE TABLE source_registry_entry_changes_v1')
    expect(migration).toContain('audit_source_registry_entry_update_v1')
    expect(migration).toContain('source_registry_entries_v1_audit_update')
    expect(migration).toContain('source_registry_entry_changes_v1_append_only')
    expect(migration).toContain('source registry entry deletion is not allowed')
    expect(migration).toContain('source registry identity is immutable')
  })

  it('stores canonical identity, evidenced locations and authoritative geometry without synthetic coordinates', () => {
    const migration = compact(up[names[1]])
    for (const table of [
      'organization_identity_profiles_v1',
      'organization_locations_v1',
      'organization_relationships_v1',
      'organization_identity_changes_v1',
      'federal_subject_geometries_v1',
    ]) {
      expect(migration).toContain(`CREATE TABLE ${table}`)
    }
    expect(migration).toContain(
      'FOREIGN KEY (workspace_id, organization_id) REFERENCES organization_identity_profiles_v1(workspace_id, organization_id)',
    )
    expect(migration).toContain('evidence_radar_evidence_ids_belong_to_org_v1')
    expect(migration).toContain("geometry_geojson->>'type' IN ('Polygon', 'MultiPolygon')")
    expect(migration).toContain('validate_federal_subject_geometry_source_v1')
  })

  it('persists all 20 normalized signal types and binds correlations to real signal provenance', () => {
    const migration = up[names[2]]
    for (const signalType of NORMALIZED_SIGNAL_TYPES) {
      expect(migration).toContain(`'${signalType}'`)
    }
    expect(migration).toContain('CREATE TABLE evidence_events_v1')
    expect(migration).toContain('CREATE TABLE normalized_signals_v1')
    expect(migration).toContain('CREATE TABLE normalized_signal_event_links_v1')
    expect(migration).toContain('CREATE TABLE evidence_correlations_v1')
    expect(migration).toContain('evidence_radar_source_allowed_v1(NEW.source_registry_id)')
    expect(migration).toContain('correlation signals must belong to one workspace and organization')
    expect(migration).toContain('correlation source families must equal referenced signal provenance')
    expect(migration).toContain('CARDINALITY(source_families) >= 2')
  })

  it('stores reproducible scores, company-level contacts and verifiable lead cards', () => {
    const migration = compact(up[names[3]])
    for (const table of [
      'evidence_lead_score_snapshots_v1',
      'public_contact_paths_v1',
      'evidence_lead_cards_v1',
    ]) {
      expect(migration).toContain(`CREATE TABLE ${table}`)
    }
    expect(migration).toContain("JSONB_TYPEOF(contributions) = 'array'")
    expect(migration).toContain('source_signal_ids BIGINT[] NOT NULL')
    expect(migration).toContain('source_correlation_ids BIGINT[] NOT NULL')
    expect(migration).toContain('independent_source_families TEXT[] NOT NULL')
    expect(migration).toContain('score independent source families must equal evidence provenance')
    expect(migration).toContain('every scored signal must be linked to scored evidence')
    expect(migration).toContain('score correlations must be composed from scored signals')
    expect(migration).toContain('persisted Evidence Radar scores do not reproduce component formula')
    expect(migration).toContain('score contribution ledger contains invalid or unscoped entries')
    expect(migration).toContain('CHECK (is_personal = FALSE)')
    expect(migration).toContain("'company_form', 'corporate_email', 'generic_hr_email', 'switchboard', 'official_channel'")
    expect(migration).toContain('lead card evidence must belong to one workspace and organization')
    expect(migration).toContain('lead card must preserve every evidence event used by its score')
    expect(migration).toContain('qualified lead requires correlation and two independent source families')
    expect(migration).toContain('lead card contacts must belong to one workspace and organization')
    expect(migration).toContain('location_id BIGINT,')
    expect(migration).not.toContain('location_id BIGINT NOT NULL')
  })

  it('rejects stale or unverified provenance before it can become an actionable lead', () => {
    const migration = compact(up[names[4]])
    expect(migration).toContain('score evidence must be verified, live and observed by snapshot time')
    expect(migration).toContain('score signals must be live, positive-strength and observed by snapshot time')
    expect(migration).toContain('score correlations must be live and available by snapshot time')
    expect(migration).toContain('score validity cannot outlive its evidence, signal or correlation horizon')
    expect(migration).toContain('qualified lead requires verified organization identity')
    expect(migration).toContain('qualified Evidence Radar lead requires a verified location')
    expect(migration).toContain('qualified lead evidence must be verified and live')
    expect(migration).toContain('qualified lead cannot expose unverified or rejected contact paths')
    expect(migration).toContain('recommended contact time must be inside the lead card validity window')
  })

  it('keeps historical evidence tables append-only and operational source changes audited', () => {
    const migration = Object.values(up).join('\n')
    for (const table of [
      'source_registry_reviews_v1',
      'source_registry_entry_changes_v1',
      'organization_identity_changes_v1',
      'organization_locations_v1',
      'organization_relationships_v1',
      'evidence_events_v1',
      'normalized_signals_v1',
      'normalized_signal_event_links_v1',
      'evidence_correlations_v1',
      'evidence_lead_score_snapshots_v1',
      'public_contact_paths_v1',
      'evidence_lead_cards_v1',
    ]) {
      expect(compact(migration)).toContain(`BEFORE UPDATE OR DELETE ON ${table}`)
    }
    expect(migration).toContain('audit_source_registry_entry_update_v1')
    expect(migration).toContain('audit_organization_identity_update_v1')
  })

  it('takes exclusive locks before every rollback that can remove Evidence Radar data', () => {
    for (const name of destructiveDataMigrationNames) {
      const rollback = down[name]
      expect(rollback).toContain('IN ACCESS EXCLUSIVE MODE')
      expect(rollback.indexOf('LOCK TABLE')).toBeLessThan(rollback.indexOf('DO $$'))
      expect(rollback).toContain('refusing to remove')
    }
  })

  it('rolls back qualification hardening without dropping Evidence Radar data', () => {
    const rollback = compact(down[names[4]])
    expect(rollback).toContain('DROP TRIGGER IF EXISTS evidence_lead_cards_v1_validate_qualification_trust')
    expect(rollback).toContain('DROP FUNCTION IF EXISTS validate_evidence_lead_qualification_trust_v1()')
    expect(rollback).toContain('DROP TRIGGER IF EXISTS evidence_lead_score_snapshots_v1_validate_temporal_trust')
    expect(rollback).not.toContain('DROP TABLE')
  })

  it('is additive and does not switch or mutate existing Opportunity readers', () => {
    const migrations = Object.values(up).join('\n')
    expect(migrations).not.toMatch(/UPDATE\s+opportunities\b/i)
    expect(migrations).not.toMatch(/DELETE\s+FROM\s+opportunities\b/i)
    expect(migrations).not.toMatch(/INSERT\s+INTO\s+opportunities\b/i)
  })
})