import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(process.cwd(), '..', '..')
const read = (...parts: string[]) => readFileSync(resolve(repoRoot, ...parts), 'utf8')

const runbook = read('docs', 'runbooks', 'source-refresh-vm-tick-authority.md')
const timer = read('ops', 'systemd', 'rr-source-refresh.timer')
const service = read('ops', 'systemd', 'rr-source-refresh.service')
const tickScript = read('scripts', 'deploy', 'source-refresh-tick.sh')

/**
 * Mirrors the bash slot computation in scripts/deploy/source-refresh-tick.sh
 * (floor((now − 15 min grace) / 1h) in UTC) so the documented grace semantics
 * stay pinned by an executable test. This is the executable spec the backend
 * route implementer must agree with — not a re-implementation source.
 */
function slotIdFor(now: Date): string {
  const floor = new Date(now.getTime() - 15 * 60 * 1000)
  const y = floor.getUTCFullYear()
  const m = String(floor.getUTCMonth() + 1).padStart(2, '0')
  const d = String(floor.getUTCDate()).padStart(2, '0')
  const h = floor.getUTCHours() // truncation to hour == floor for the hour component
  return `${y}-${m}-${d}T${String(h).padStart(2, '0')}:00:00Z`
}

describe('source-refresh VM tick authority (runbook amendment)', () => {
  it('amends the protocol with a single VM authority and explicit GHA demotion', () => {
    expect(runbook).toContain('единственным authoritative tick generator')
    expect(runbook).toContain('authority=vm-systemd')
    expect(runbook).toContain('не закрывают slot')
    expect(runbook).toContain('day-level')
    // Amendment anchors required by the task contract.
    expect(runbook).toContain('9.1')
    expect(runbook).toContain('§15')
    expect(runbook).toContain('§17.2')
    // Fail-closed window semantics survive the amendment unchanged.
    expect(runbook).toContain('не backfill')
    expect(runbook).toContain('остаются отсутствующими')
    expect(runbook).toContain('missing/late')
    expect(runbook).toMatch(/missing|пропущенный/i)
  })

  it('keeps production activation behind the owner gate', () => {
    expect(runbook).toContain('НЕ применён на production')
    expect(runbook).toContain('fresh snapshot + pg_dump')
    expect(runbook).toContain('owner gate')
    // Rollback must exist and must not drop append-only evidence.
    expect(runbook).toContain('systemctl disable --now rr-source-refresh.timer')
    expect(runbook).toContain('не дропается')
  })

  it('pins the systemd timer to exactly 24 canonical UTC slots per day', () => {
    expect(timer).toContain('OnCalendar=*:15:00 UTC')
    expect(timer).toContain('Persistent=true')
    expect(timer).toContain('RandomizedDelaySec=0')
    expect(timer).toContain('AccuracySec=1s')
    expect(timer).toContain('Unit=rr-source-refresh.service')
  })

  it('keeps the tick service oneshot, bounded, and journal-logged', () => {
    expect(service).toContain('Type=oneshot')
    expect(service).toContain('WorkingDirectory=/opt/recruiter-radar')
    expect(service).toContain('ExecStart=/opt/recruiter-radar/source-refresh-tick.sh')
    expect(service).toContain('TimeoutStartSec=25min')
    expect(service).toContain('StandardOutput=journal')
  })

  it('keeps the tick script deterministic, secretless, and exit-mapped', () => {
    expect(tickScript).toContain('set -euo pipefail')
    expect(tickScript).toContain('SLOT_GRACE_MINUTES=15')
    expect(tickScript).toContain('"authority":"vm-systemd"')
    // The script itself must never hold the cron key: it lives in the web runtime only.
    expect(tickScript).not.toMatch(/CRON_API_KEY\s*=/)
    expect(tickScript).toMatch(/CRON_API_KEY is not configured in the web runtime/)
    // Exit-code mapping: 422 no-op and duplicates are zero, real failures are not.
    expect(tickScript).toContain("new Set(['success', 'degraded_ok', 'no_op_422', 'duplicate_skipped'])")
    expect(tickScript).toContain('TICK_PATH="${TICK_PATH:-/api/cron/source-refresh}"')
    expect(tickScript).toContain("method: 'POST'")
    expect(tickScript).not.toContain('/api/cron/source-refresh/tick')
  })

  it('maps slot boundaries exactly as the 15-minute grace prescribes', () => {
    // :00 exactly -> previous hour owns the slot (now - 15min falls back).
    expect(slotIdFor(new Date('2026-08-29T10:00:00Z'))).toBe('2026-08-29T09:00:00Z')
    // :14 -> still previous hour.
    expect(slotIdFor(new Date('2026-08-29T10:14:59Z'))).toBe('2026-08-29T09:00:00Z')
    // :15 -> current hour (boundary inclusive).
    expect(slotIdFor(new Date('2026-08-29T10:15:00Z'))).toBe('2026-08-29T10:00:00Z')
    // :45 -> current hour.
    expect(slotIdFor(new Date('2026-08-29T10:45:00Z'))).toBe('2026-08-29T10:00:00Z')
    // Midnight rollover: 00:10 belongs to 23:00 of the previous UTC day.
    expect(slotIdFor(new Date('2026-08-30T00:10:00Z'))).toBe('2026-08-29T23:00:00Z')
    // Month/year rollovers stay UTC-canonical.
    expect(slotIdFor(new Date('2026-01-01T00:07:00Z'))).toBe('2025-12-31T23:00:00Z')
    // Leap-day rollover.
    expect(slotIdFor(new Date('2028-03-01T00:05:00Z'))).toBe('2028-02-29T23:00:00Z')
  })

  it('defines the tick ledger contract fields required by the protocol', () => {
    for (const field of [
      'slot_id',
      'scheduled_at',
      'observed_at',
      'attempt',
      'authority',
      'deploy_sha',
      'tick_result',
    ]) expect(runbook).toContain(`\`${field}\``)
    // Exactly-once semantics must be explicit.
    expect(runbook).toContain('ON CONFLICT')
    expect(runbook).toContain('duplicate_skipped')
    // Lateness budget with fail-closed late handling.
    expect(runbook).toContain('late=true')
  })

  it('documents the two-authority transition window as safe and temporary', () => {
    expect(runbook).toContain('Двух-authority интервал')
    expect(runbook).toContain('github-schedule-legacy')
    expect(runbook).toContain('не-authoritative шумом')
  })
})
