import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const route = readFileSync(
  resolve(process.cwd(), 'app', 'api', 'cron', 'daily-radar', 'route.ts'),
  'utf8',
)

describe('daily radar channel eligibility contract', () => {
  it('does not require Telegram when another enabled channel is usable', () => {
    expect(route).not.toContain('AND telegram_chat_id IS NOT NULL\n      AND delivery_enabled')
    expect(route).toContain('email_digest_enabled = true AND digest_email IS NOT NULL')
    expect(route).toContain('FROM web_push_subscriptions wps')
    expect(route).toContain('wps.revoked_at IS NULL')
    expect(route).not.toContain('wps.is_active')
    expect(route).toContain('FROM notification_routes nr')
    expect(route).toContain("nr.event_kind = 'daily_digest'")
  })

  it('derives temporal intelligence after source ingestion and reports the stage', () => {
    expect(route).toContain('runSourceTemporalIntelligence')
    expect(route.indexOf('await ingestDailyRadarSources()')).toBeLessThan(
      route.indexOf('await runSourceTemporalIntelligence()'),
    )
    expect(route).toContain('temporal: { ok: temporalResult.success, ...temporalResult }')
  })
})
