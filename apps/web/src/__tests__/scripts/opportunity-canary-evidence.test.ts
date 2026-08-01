/** @jest-environment node */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const verifier = path.resolve(
  process.cwd(),
  '../../packages/db/scripts/verify-opportunity-canary-evidence.mjs',
)

const scenarios = [
  'shown -> opened -> accepted -> contacted -> replied -> meeting -> meeting_completed -> proposal -> won',
  'contacted -> snoozed -> resumed -> replied',
  'meeting -> meeting_cancelled -> meeting -> meeting_completed',
  'won -> reverted -> proposal',
]

const gates = [
  'actor_attribution',
  'workspace_scope',
  'cross_tenant_denied',
  'idempotent_replay',
  'changed_payload_conflict',
  'raw_contact_privacy',
  'morning_brief_queues',
  'pipeline_queues',
  'completed_queues',
  'funnel_counters',
  'rebuild_zero_drift',
  'external_ingestion_404',
]

function evidence(overrides: string[] = []) {
  return [
    '<!-- opportunity-canary-evidence:v1 -->',
    'status: blocked',
    'production_sha: NOT_VERIFIED',
    'owner_scope: REDACTED',
    'workspace_scope: REDACTED',
    'blocker: Live production execution requires separate action-time approval.',
    'next_action: Approve the exact scoped commands after selecting one eligible internal workspace.',
    '',
    '## Required scenarios',
    ...scenarios.map((scenario) => `- [ ] \`${scenario}\` - NOT_RUN`),
    '',
    '## Required gates',
    ...gates.map((gate) => `- [ ] ${gate}: NOT_RUN`),
    '',
    '## Command evidence',
    '- NOT_RUN - external production blocker.',
    ...overrides,
  ].join('\n')
}

function passedEvidence() {
  return evidence([
    '- preflight_ok=true',
    '- pre_activation_ready=true',
    '- active_ready=true',
    '- idempotent_replay=true',
    '- changed_payload_status=409',
    '- rebuildChanged=0',
    '- external_status=404',
  ])
    .replace('status: blocked', 'status: passed')
    .replace('production_sha: NOT_VERIFIED', `production_sha: ${'a'.repeat(40)}`)
    .replace('owner_scope: REDACTED', `owner_scope: sha256:${'b'.repeat(12)}`)
    .replace('workspace_scope: REDACTED', `workspace_scope: sha256:${'c'.repeat(12)}`)
    .replaceAll('- [ ]', '- [x]')
    .replaceAll('NOT_RUN', 'PASS')
}

function verify(content: string) {
  const directory = mkdtempSync(path.join(tmpdir(), 'opportunity-canary-'))
  const file = path.join(directory, 'evidence.md')
  writeFileSync(file, content, 'utf8')
  const result = spawnSync(process.execPath, [verifier, '--file', file], {
    cwd: path.resolve(process.cwd(), '../..'),
    encoding: 'utf8',
  })
  rmSync(directory, { recursive: true, force: true })
  return result
}

describe('opportunity production canary evidence verifier', () => {
  it('accepts a complete, explicit external blocker without claiming live completion', () => {
    const result = verify(evidence())

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      event: 'opportunity_canary.evidence_verified',
      status: 'blocked',
      complete: false,
      valid: true,
    })
  })

  it('rejects a passed claim while any required scenario or gate is not run', () => {
    const result = verify(evidence().replace(
      'status: blocked',
      'status: passed',
    ))

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('passed evidence contains incomplete checks')
  })

  it('accepts passed evidence only when every required result is PASS', () => {
    const passed = verify(passedEvidence())
    const failedGate = verify(passedEvidence().replace(
      '- [x] workspace_scope: PASS',
      '- [x] workspace_scope: FAIL',
    ))

    expect(passed.status).toBe(0)
    expect(JSON.parse(passed.stdout)).toMatchObject({
      status: 'passed',
      complete: true,
      valid: true,
    })
    expect(failedGate.status).toBe(2)
    expect(failedGate.stderr).toContain('workspace_scope must be checked PASS')
  })

  it('rejects raw contact data and secret-like values', () => {
    const result = verify(evidence([
      '- operator_email: canary.operator@example.test',
      '- authorization: Bearer should-not-be-recorded',
    ]))

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('privacy-safe')
  })

  it('allows ISO dates while rejecting a raw phone number', () => {
    const dated = verify(evidence(['- observed_at: 2026-08-01T09:30:00Z']))
    const withPhone = verify(evidence(['- operator_phone: +7 999 123-45-67']))

    expect(dated.status).toBe(0)
    expect(withPhone.status).toBe(2)
    expect(withPhone.stderr).toContain('privacy-safe')
  })

  it('requires every lifecycle scenario and operational gate from Phase 3', () => {
    const result = verify(
      evidence().replace(scenarios[2], 'meeting scenario omitted'),
    )

    expect(result.status).toBe(2)
    expect(result.stderr).toContain(scenarios[2])
  })
})
