import fs from 'node:fs'
import path from 'node:path'

import {
  classifyDeliveryReadiness,
  normalizeReadinessWindowHours,
} from '@/lib/operational-readiness'

describe('operational readiness classification', () => {
  test.each([
    [{ latestRunId: '1', latestRunStatus: 'completed', selectedCount: 3, lastDeliveredAt: '2026-07-20', lastFailureAt: null }, 'delivered'],
    [{ latestRunId: null, latestRunStatus: null, selectedCount: null, lastDeliveredAt: null, lastFailureAt: null }, 'no_digest_run'],
    [{ latestRunId: '2', latestRunStatus: 'failed', selectedCount: 0, lastDeliveredAt: null, lastFailureAt: null }, 'digest_failed'],
    [{ latestRunId: '3', latestRunStatus: 'completed', selectedCount: 0, lastDeliveredAt: null, lastFailureAt: null }, 'empty_digest'],
    [{ latestRunId: '4', latestRunStatus: 'completed', selectedCount: 2, lastDeliveredAt: null, lastFailureAt: '2026-07-20' }, 'delivery_failed'],
    [{ latestRunId: '5', latestRunStatus: 'completed', selectedCount: 2, lastDeliveredAt: null, lastFailureAt: null }, 'not_delivered'],
  ] as const)('classifies %j as %s', (input, expected) => {
    expect(classifyDeliveryReadiness(input)).toBe(expected)
  })

  test('bounds the reporting window', () => {
    expect(normalizeReadinessWindowHours(undefined)).toBe(24)
    expect(normalizeReadinessWindowHours(0)).toBe(1)
    expect(normalizeReadinessWindowHours(24.9)).toBe(24)
    expect(normalizeReadinessWindowHours(10_000)).toBe(168)
  })
})

describe('readiness SQL contract', () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), 'lib/operational-readiness.ts'),
    'utf8',
  )

  test('uses the same channel families as daily radar eligibility', () => {
    expect(source).toContain('telegram_chat_id IS NOT NULL')
    expect(source).toContain('email_digest_enabled = true')
    expect(source).toContain('web_push_subscriptions')
    expect(source).toContain("npa.provider = 'telegram'")
    expect(source).toContain("npa.provider = 'vk'")
    expect(source).toContain("npa.provider = 'webhook'")
  })

  test('does not flag weekly profiles outside the target day', () => {
    expect(source).toContain("cp.delivery_frequency <> 'weekly'")
    expect(source).toContain("AT TIME ZONE 'Europe/Moscow'")
  })

  test('returns operational identifiers, not agency/contact/destination values', () => {
    // Reading `digest_email IS NOT NULL` is required to decide eligibility. The
    // privacy boundary is that the address itself is never selected or returned.
    expect(source).not.toMatch(/agency_name|customer_contact|digest_email\s+AS|destination_id\s+AS/i)
    expect(source).toContain("event_name = 'digest_delivered'")
    expect(source).toContain("event_name = 'delivery_failed'")
  })
})
