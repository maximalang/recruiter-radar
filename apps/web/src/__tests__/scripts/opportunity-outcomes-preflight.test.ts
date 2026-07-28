import fs from 'node:fs'
import path from 'node:path'

const source = fs.readFileSync(
  path.resolve(
    process.cwd(),
    '../../packages/db/scripts/preflight-opportunity-outcomes.mjs',
  ),
  'utf8',
)

describe('opportunity outcome migration preflight', () => {
  it('is read-only, owner-scoped, privacy-safe, and blocking', () => {
    expect(source).toContain(
      'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
    )
    expect(source).toContain('--owner-id')
    expect(source).toContain('--json')
    expect(source).toContain('process.exitCode = 2')
    expect(source).not.toContain('reason_note')
    expect(source).not.toContain('value_minor')
    expect(source).not.toMatch(/SELECT[\s\S]*contact_reference\s+AS/i)
  })

  it.each([
    'commercial_chronology_conflict',
    'conflicting_terminal_outcomes',
    'invalid_snooze',
    'invalid_meeting_lifecycle',
    'invalid_actor_user_pairing',
    'raw_contact_reference',
    'projection_ledger_mismatch',
    'orphan_context',
    'duplicated_correction_target',
    'projection_cross_opportunity_event',
    'post_supersession_effective_event',
  ])('checks %s', (violationCode) => {
    expect(source).toContain(`code: '${violationCode}'`)
  })

  it('derives projection checks from the effective ledger', () => {
    expect(source).toContain("candidate.event_type <> 'reverted'")
    expect(source).toContain('correction.reverts_event_id = candidate.id')
    expect(source).toContain(
      'candidate.last_event_id IS DISTINCT FROM expected.last_event_id',
    )
    expect(source).toContain('candidate.opportunity_id IS NULL')
    expect(source).toContain(
      'candidate.previous_stage IS DISTINCT FROM candidate.new_stage',
    )
  })

  it('only permits a repeated meeting after cancellation or no-show', () => {
    expect(source).toContain('prior_meeting_event_type IS NOT NULL')
    expect(source).toMatch(
      /prior_meeting_event_type NOT IN \(\r?\n\s+'meeting_cancelled', 'meeting_no_show'/,
    )
  })
})
