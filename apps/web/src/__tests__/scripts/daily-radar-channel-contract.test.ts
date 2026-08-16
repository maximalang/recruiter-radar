import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const route = readFileSync(
  resolve(process.cwd(), 'app', 'api', 'cron', 'daily-radar', 'route.ts'),
  'utf8',
)
const eligibility = readFileSync(
  resolve(process.cwd(), 'lib', 'daily-radar-profile-eligibility.ts'),
  'utf8',
)

describe('daily radar channel eligibility contract', () => {
  it('does not require Telegram when another enabled channel is usable', () => {
    expect(route).not.toContain('AND telegram_chat_id IS NOT NULL\n      AND delivery_enabled')
    expect(eligibility).toContain('cp.email_digest_enabled = TRUE AND cp.digest_email IS NOT NULL')
    expect(eligibility).toContain('FROM web_push_subscriptions wps')
    expect(eligibility).toContain('wps.revoked_at IS NULL')
    expect(eligibility).not.toContain('wps.is_active')
    expect(eligibility).toContain('FROM notification_routes nr')
    expect(eligibility).toContain("nr.event_kind = 'daily_digest'")
  })

  it('derives temporal intelligence after source ingestion and reports the stage', () => {
    expect(route).toContain('runSourceTemporalIntelligence')
    expect(route.indexOf('await runScheduledSourceRefresh()')).toBeLessThan(
      route.indexOf('await runSourceTemporalIntelligence()'),
    )
    expect(route).toContain('temporal: { ok: temporalResult.success, ...temporalResult }')
  })
})
