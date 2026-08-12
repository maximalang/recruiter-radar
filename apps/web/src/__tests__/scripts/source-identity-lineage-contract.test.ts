import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const repoRoot = resolve(process.cwd(), '..', '..')
const migrationName = '20260812150000_add_source_signal_evidence_lineage'
const migrationPath = resolve(repoRoot, 'packages', 'db', 'migrations', `${migrationName}.sql`)
const rollbackPath = resolve(repoRoot, 'packages', 'db', 'migrations', `${migrationName}.down.sql`)
const runtimePath = resolve(repoRoot, 'packages', 'db', 'scripts', 'adapters', 'rf-source-runtime.mjs')
const resolutionPath = resolve(repoRoot, 'packages', 'db', 'scripts', 'adapters', 'organization-resolution.mjs')
const packageJsonPath = resolve(repoRoot, 'package.json')

describe('source identity and evidence lineage contract', () => {
  it('keeps source evidence lineage append-only and organization-consistent', () => {
    const migration = readFileSync(migrationPath, 'utf8')
    const rollback = readFileSync(rollbackPath, 'utf8')

    expect(migration).toContain('CREATE TABLE source_signal_evidence_lineage_v1')
    expect(migration).toContain('FOREIGN KEY (signal_id, organization_id)')
    expect(migration).toContain('REFERENCES signals(id, org_id)')
    expect(migration).toContain('FOREIGN KEY (evidence_id, organization_id)')
    expect(migration).toContain('REFERENCES evidence_items(id, org_id)')
    expect(migration).toContain('UNIQUE (signal_id, evidence_id)')
    expect(migration).toContain('source_signal_evidence_lineage_v1_append_only')
    expect(migration).toContain('BEFORE UPDATE OR DELETE')
    expect(migration).toContain("CHECK (source_url ~ '^https?://')")
    expect(migration).toContain("CHECK (evidence_tier IN ('direct', 'corroboration', 'context'))")
    expect(migration).toContain("CHECK (JSONB_TYPEOF(confidence) = 'object')")
    expect(migration).toContain("CHECK (JSONB_TYPEOF(signal_payload_snapshot) = 'object')")

    expect(rollback).toContain('refusing to remove non-empty source signal evidence lineage')
    expect(rollback).not.toContain('DROP INDEX signals_id_org_uidx')
  })

  it('resolves only validated strong keys globally and never names', () => {
    const script = [
      `import { classifyStrongIdentityKey } from ${JSON.stringify(`file:///${resolutionPath.replaceAll('\\', '/')}`)};`,
      "const values = ['inn:7707083893', 'inn:7707083894', 'ogrn:1027700132195', 'domain:www.example.ru', 'company-name:пример'];",
      'console.log(JSON.stringify(values.map((value) => classifyStrongIdentityKey(value))));',
    ].join('\n')
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: repoRoot,
      encoding: 'utf8',
    })

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual([
      { key: 'inn:7707083893', type: 'inn' },
      null,
      { key: 'ogrn:1027700132195', type: 'ogrn' },
      { key: 'domain:example.ru', type: 'domain' },
      null,
    ])
  })

  it('asserts source-ref ownership and writes policy-derived evidence plus lineage', () => {
    const runtime = readFileSync(runtimePath, 'utf8')

    expect(runtime).toContain('resolveOrganizationOwner')
    expect(runtime).toContain('assertOrgSourceRefOwner')
    expect(runtime).toContain('writeEvidence')
    expect(runtime).toContain('source_signal_evidence_lineage_v1')
    expect(runtime).toContain("evidenceRole === 'primary_platform' ? 'corroboration' : 'context'")
    expect(runtime).not.toContain("evidenceRole === 'primary_platform' ? 'direct'")
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
    expect(packageJson.scripts['verify:source:identity-lineage']).toContain('verify-source-identity-lineage.mjs')
  })
})
