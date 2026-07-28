import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const script = readFileSync(
  resolve(
    process.cwd(),
    '..',
    '..',
    'packages',
    'db',
    'scripts',
    'rebuild-opportunity-outcomes.mjs',
  ),
  'utf8',
)

describe('opportunity outcome projection rebuild contract', () => {
  it('is dry-run by default and applies only when explicitly requested', () => {
    expect(script).toContain("const apply = argumentsSet.has('--apply')")
    expect(script).toContain('Cannot combine --apply with --dry-run.')
    expect(script).toContain("await client.query('COMMIT')")
    expect(script).toContain("await client.query('ROLLBACK')")
    expect(script).toContain('NOT EXISTS (')
  })

  it('rebuilds deterministically from append order and preserves tenant context', () => {
    expect(script).toContain('(ARRAY_AGG(id ORDER BY id DESC))[1] AS last_event_id')
    expect(script).toContain('commercial_stage AS current_stage')
    expect(script).toMatch(/GROUP BY\r?\n\s+context\.owner_id,/)
    expect(script).toContain('meeting_attempt_count')
    expect(script).toContain('active_meeting_event_id')
    expect(script).toContain('ORDER BY owner_id, opportunity_id')
  })

  it('takes an exclusive owner lock while writers use the shared lock', () => {
    expect(script).toContain("hashtextextended('opportunity-outcome-owner:' || $1, 0)")
    expect(script).toContain('SELECT owner_id::TEXT AS "ownerId"')
    expect(script).toContain('GROUP BY owner_id')
    expect(script).toContain('for (const owner of owners.rows)')
  })

  it('reports the required observability counters without outcome payloads', () => {
    expect(script).toContain("'opportunity_outcome.rebuild_started'")
    expect(script).toContain("'opportunity_outcome.rebuild_completed'")
    expect(script).toContain("'opportunity_outcome.rebuild_failed'")
    expect(script).toContain('rebuildScanned')
    expect(script).toContain('ownersScanned')
    expect(script).toContain('opportunitiesScanned')
    expect(script).toContain('eventsScanned')
    expect(script).toContain('workflowStatesRebuilt')
    expect(script).toContain('correctionsApplied')
    expect(script).toContain('rebuildChanged')
    expect(script).toContain('rebuildFailed')
    expect(script).not.toContain('reason_note')
    expect(script).not.toContain('contact_reference')
  })
})
