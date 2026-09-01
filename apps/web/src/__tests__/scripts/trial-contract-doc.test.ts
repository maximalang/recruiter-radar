import { readFileSync } from 'node:fs'
import path from 'node:path'

describe('verified trial contract documents', () => {
  const adr = readFileSync(
    path.resolve(process.cwd(), '../../docs/adr/20260825-verified-three-day-trial.md'),
    'utf8',
  )
  const threatModel = readFileSync(
    path.resolve(process.cwd(), '../../docs/threat-models/verified-trial-auth-profile.md'),
    'utf8',
  )

  it('pins the server-side three-day and immutable-profile contract', () => {
    expect(adr).toContain('radar-trial-3d')
    expect(adr).toContain('3 * 24 hours')
    expect(adr).toContain('trial_already_used')
    expect(adr).toMatch(/database triggers or\s+row-level guards/)
    expect(adr).toContain('payment-connect, Telegram, admin, API')
    expect(adr).toContain('After the three-day window')
  })

  it('pins the anti-abuse and provider security controls', () => {
    expect(threatModel).toContain('Durable unique binding claim + idempotency key')
    expect(threatModel).toContain('Parallel activation yields one entitlement/profile')
    expect(threatModel).toContain('Provider subject mapping + verified challenge + recent reauth')
    expect(threatModel).toContain('No implicit break-glass')
    expect(threatModel).toContain('fail-open')
  })
})
