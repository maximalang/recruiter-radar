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
] as const

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
    expect(migration).toContain('source_registry_entries_v1_immutable')
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

  it('persists all 20 normalized signal types and evidence/correlation provenance', () => {
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
    expect(migration).toContain('CARDINALITY(source_families) >= 2')
  })

  it('stores explainable scores, company-level contacts and verifiable lead cards', () => {
    const migration = compact(up[names[3]])
    for (const table of [
      'evidence_lead_score_snapshots_v1',
      'public_contact_paths_v1',
      'evidence_lead_cards_v1',
    ]) {
      expect(migration).toContain(`CREATE TABLE ${table}`)
    }
    expect(migration).toContain("JSONB_TYPEOF(contributions) = 'array'")
    expect(migration).toContain('independent_source_families TEXT[] NOT NULL')
    expect(migration).toContain('CHECK (is_personal = FALSE)')
    expect(migration).toContain("'company_form', 'corporate_email', 'generic_hr_email', 'switchboard', 'official_channel'")
    expect(migration).toContain('lead card evidence must belong to one workspace and organization')
    expect(migration).toContain('lead card contacts must belong to one workspace and organization')
  })

  it('keeps every evidence history table append-only', () => {
    const migration = Object.values(up).join('\n')
    for (const table of [
      'source_registry_reviews_v1',
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
  })

  it('takes exclusive locks before every data-loss rollback check', () => {
    for (const name of names) {
      const rollback = down[name]
      expect(rollback).toContain('IN ACCESS EXCLUSIVE MODE')
      expect(rollback.indexOf('LOCK TABLE')).toBeLessThan(rollback.indexOf('DO $$'))
      expect(rollback).toContain('refusing to remove')
    }
  })

  it('is additive and does not switch or mutate existing Opportunity readers', () => {
    const migrations = Object.values(up).join('\n')
    expect(migrations).not.toMatch(/UPDATE\s+opportunities\b/i)
    expect(migrations).not.toMatch(/DELETE\s+FROM\s+opportunities\b/i)
    expect(migrations).not.toMatch(/INSERT\s+INTO\s+opportunities\b/i)
  })
})