import fs from 'node:fs'
import path from 'node:path'

import { validateWebhookUrl } from '@/lib/notification-providers'

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8')
}

describe('outbound webhook SSRF boundary', () => {
  const previousNodeEnv = process.env.NODE_ENV

  beforeAll(() => {
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'production', configurable: true })
  })

  afterAll(() => {
    Object.defineProperty(process.env, 'NODE_ENV', { value: previousNodeEnv, configurable: true })
  })

  test.each([
    'http://example.com/hook',
    'https://user:password@example.com/hook',
    'https://127.0.0.1/hook',
    'https://10.0.0.1/hook',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/hook',
    'https://[fc00::1]/hook',
    'https://[fe80::1]/hook',
    'https://[::ffff:127.0.0.1]/hook',
    'https://service.internal/hook',
  ])('rejects %s', (url) => {
    expect(() => validateWebhookUrl(url)).toThrow()
  })

  test('allows a public HTTPS target before the DNS-time check', () => {
    expect(validateWebhookUrl('https://hooks.example.com/radar').toString()).toBe('https://hooks.example.com/radar')
  })

  test('send path enforces DNS validation, no redirects, timeout and bounded response diagnostics', () => {
    const providers = read('lib/notification-providers.ts')
    expect(providers).toContain('assertPublicWebhookTarget(target)')
    expect(providers).toContain('redirect: "manual"')
    expect(providers).toContain('AbortSignal.timeout(15_000)')
    expect(providers).toContain('readResponseTextWithLimit')
    expect(providers).toContain('2_000')
  })
})

describe('tenant and entitlement boundaries', () => {
  test('bulk and single CSV exports derive owner scope from the session', () => {
    for (const file of ['app/api/leads/export/route.ts', 'app/api/leads/[id]/export/route.ts']) {
      const source = read(file)
      expect(source).toContain('getSession')
      expect(source).toContain("'exports:create'")
      expect(source).toContain('workspaceId')
      expect(source).toMatch(/ownerId/)
      expect(source).toContain("'Cache-Control': 'no-store'")
    }
  })

  test('digest generation and delivery perform server-side entitlement checks', () => {
    for (const file of ['app/api/digest/route.ts', 'app/api/digest/delivery/route.ts', 'app/api/hh/digest/route.ts']) {
      const source = read(file)
      expect(source).toContain('assertDigestEntitlementByClientProfileId')
      expect(source).toMatch(/403|not allowed|entitlement/i)
    }
  })
})

describe('webhook replay and secret handling', () => {
  test('billing webhook has secret auth, deterministic idempotency and claim ownership', () => {
    const billing = read('app/api/billing/webhook/route.ts')
    expect(billing).toContain('x-billing-secret')
    expect(billing).toContain('ON CONFLICT (provider, idempotency_key) DO NOTHING')
    expect(billing).toContain('claim_token')
    expect(billing).toContain('duplicate: true')
    expect(billing).not.toMatch(/return NextResponse\.json\([^\n]*errorMessage/)
  })

  test('notification inbound events are protected by a unique replay hash', () => {
    const migration = read('../../packages/db/migrations/20260716010000_add_notification_delivery_platform.sql')
    expect(migration).toContain('uq_notification_inbound_event_hash')
    expect(migration).toContain('(provider_account_id, event_hash)')
  })

  test('telemetry rejects secret-shaped metadata at both TS and DB boundaries', () => {
    const telemetry = read('lib/telemetry.ts')
    const migration = read('../../packages/db/migrations/20260720130000_add_product_telemetry.sql')
    expect(telemetry).toContain('SENSITIVE_KEY')
    expect(migration).toContain('product_telemetry_metadata_is_safe')
    expect(migration).toContain('product_telemetry_metadata_privacy')
  })
})

describe('parameterized database writes', () => {
  test.each([
    'lib/digestFeedbackCore.mjs',
    'lib/paymentsRepo.ts',
    'lib/telemetry.ts',
  ])('%s uses placeholders for mutation input', (file) => {
    const source = read(file)
    expect(source).toMatch(/\$1/)
    expect(source).toContain('.query')
  })

  test('typed feedback API delegates to the shared mutation core', () => {
    const source = read('lib/digestFeedback.ts')
    expect(source).toContain('updateDigestOrgStateFeedbackCore')
    expect(source).toContain('getPool')
  })
})
