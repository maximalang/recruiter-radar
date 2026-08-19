import { evaluateSourceActivation } from '@/lib/sources/source-activation'

describe('source activation modes', () => {
  test('HH is credential-gated with only HH_USER_AGENT', () => {
    expect(evaluateSourceActivation('hh', {}, {
      HH_USER_AGENT: 'Recruiter Radar ops@example.com',
    })).toMatchObject({
      state: 'credential-gated',
      mode: null,
      missingByMode: {
        'application-token': expect.arrayContaining(['HH_ACCESS_TOKEN']),
        'application-oauth-bootstrap': expect.arrayContaining(['HH_CLIENT_ID', 'HH_CLIENT_SECRET']),
      },
    })
  })

  test('HH is configured with the complete application OAuth bootstrap mode', () => {
    expect(evaluateSourceActivation('hh', {}, {
      HH_USER_AGENT: 'Recruiter Radar ops@example.com',
      HH_CLIENT_ID: 'client-id',
      HH_CLIENT_SECRET: 'client-secret',
    })).toMatchObject({ state: 'configured', mode: 'application-oauth-bootstrap' })
  })

  test('HH is configured with a pre-issued application token', () => {
    expect(evaluateSourceActivation('hh', {}, {
      HH_USER_AGENT: 'Recruiter Radar ops@example.com',
      HH_ACCESS_TOKEN: 'application-access-token',
    })).toMatchObject({ state: 'configured', mode: 'application-token' })
  })

  test('multi-mode sources accept one complete mode and reject partial modes', () => {
    expect(evaluateSourceActivation('superjob', {}, {
      SUPERJOB_INPUT_FILE: '/tmp/superjob.json',
    })).toMatchObject({ state: 'configured', mode: 'reviewed-file' })

    expect(evaluateSourceActivation('superjob', {}, {})).toMatchObject({
      state: 'credential-gated',
      mode: null,
    })
  })

  test('transparent business can reuse the verified FNS snapshot root', () => {
    expect(evaluateSourceActivation('transparent-business-fns', {}, {
      SOURCE_SNAPSHOT_ROOT: '/var/lib/recruiter-radar/snapshots',
    })).toMatchObject({
      state: 'configured',
      mode: 'official-fns-open-data-snapshot',
    })
  })

  test('Telegram remains unavailable even if MTProto credentials are present', () => {
    expect(evaluateSourceActivation('telegram-company-channels', {}, {
      TELEGRAM_API_ID: '12345',
      TELEGRAM_API_HASH: 'hash',
      TELEGRAM_SESSION: 'session',
    })).toMatchObject({
      state: 'unavailable',
      mode: null,
    })
  })
})
