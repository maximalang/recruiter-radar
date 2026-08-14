import { evaluateSourceActivation } from '@/lib/sources/source-activation'

describe('source activation modes', () => {
  test('HH is credential-gated with only HH_USER_AGENT', () => {
    expect(evaluateSourceActivation('hh', {}, {
      HH_USER_AGENT: 'Recruiter Radar ops@example.com',
    })).toMatchObject({
      state: 'credential-gated',
      mode: null,
      missingByMode: {
        'application-oauth': expect.arrayContaining(['HH_CLIENT_ID', 'HH_CLIENT_SECRET']),
      },
    })
  })

  test('HH is configured only with the complete application OAuth mode', () => {
    expect(evaluateSourceActivation('hh', {}, {
      HH_USER_AGENT: 'Recruiter Radar ops@example.com',
      HH_CLIENT_ID: 'client-id',
      HH_CLIENT_SECRET: 'client-secret',
    })).toMatchObject({ state: 'configured', mode: 'application-oauth' })
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
})
