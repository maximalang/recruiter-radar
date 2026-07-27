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
    expect(script).toContain("await client.query(apply ? 'COMMIT' : 'ROLLBACK')")
    expect(script).toContain("'DELETE FROM opportunity_outcome_state WHERE owner_id = $1'")
  })

  it('rebuilds deterministically from append order and preserves tenant context', () => {
    expect(script).toContain('(ARRAY_AGG(new_stage ORDER BY id DESC))[1]')
    expect(script).toContain('MAX(id) AS last_event_id')
    expect(script).toContain('GROUP BY\n      owner_id,')
    expect(script).toContain('ORDER BY owner_id, opportunity_id')
  })

  it('reports the required observability counters without outcome payloads', () => {
    expect(script).toContain("'opportunity_outcome.rebuild_started'")
    expect(script).toContain("'opportunity_outcome.rebuild_completed'")
    expect(script).toContain("'opportunity_outcome.rebuild_failed'")
    expect(script).toContain('rebuildScanned')
    expect(script).toContain('rebuildChanged')
    expect(script).toContain('rebuildFailed')
    expect(script).not.toContain('reason_note')
    expect(script).not.toContain('contact_reference')
  })
})
