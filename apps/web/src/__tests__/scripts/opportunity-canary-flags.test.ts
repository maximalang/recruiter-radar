/** @jest-environment node */

import path from 'node:path'

type CanaryFlags = {
  engine: boolean
  outcomes: boolean
  ui: boolean
}

const {
  isOpportunityCanaryActivationReady,
  resolveOpportunityCanaryFlags,
} = require(path.resolve(
  process.cwd(),
  '../../packages/db/scripts/lib/opportunity-canary-flags.cjs',
)) as {
  isOpportunityCanaryActivationReady: (
    ownerId: string,
    phase: 'pre_activation' | 'active',
    env: Readonly<Record<string, string | undefined>>,
    workspaceId?: string | null,
  ) => boolean
  resolveOpportunityCanaryFlags: (
    ownerId: string,
    env: Readonly<Record<string, string | undefined>>,
    workspaceId?: string | null,
  ) => CanaryFlags
}

describe('opportunity canary effective flags', () => {
  it('enables only an exactly allowlisted positive owner', () => {
    const env = {
      OPPORTUNITY_ENGINE_V1_ENABLED: 'false',
      OPPORTUNITY_OUTCOMES_ENABLED: 'false',
      OPPORTUNITY_OUTCOMES_UI_ENABLED: 'false',
      OPPORTUNITY_CANARY_OWNER_IDS: ' 7 ',
    }

    expect(resolveOpportunityCanaryFlags('7', env)).toEqual({
      engine: true,
      outcomes: true,
      ui: true,
    })
    expect(resolveOpportunityCanaryFlags('8', env)).toEqual({
      engine: false,
      outcomes: false,
      ui: false,
    })
    for (const invalid of ['7,19', '7,', ',7', '7,,']) {
      expect(resolveOpportunityCanaryFlags('7', {
        ...env,
        OPPORTUNITY_CANARY_OWNER_IDS: invalid,
      })).toEqual({
        engine: false,
        outcomes: false,
        ui: false,
      })
    }
  })

  it('fails closed for malformed owner IDs and wildcard-like entries', () => {
    const env = {
      OPPORTUNITY_CANARY_OWNER_IDS: '*,0,-1,07,7x',
    }

    expect(resolveOpportunityCanaryFlags('7', env)).toEqual({
      engine: false,
      outcomes: false,
      ui: false,
    })
    expect(resolveOpportunityCanaryFlags('07', {
      OPPORTUNITY_CANARY_OWNER_IDS: '07',
    })).toEqual({
      engine: false,
      outcomes: false,
      ui: false,
    })
  })

  it('preserves the existing exact-true global rollout contract', () => {
    expect(resolveOpportunityCanaryFlags('8', {
      OPPORTUNITY_ENGINE_V1_ENABLED: 'true',
      OPPORTUNITY_OUTCOMES_ENABLED: 'true',
      OPPORTUNITY_OUTCOMES_UI_ENABLED: 'true',
    })).toEqual({
      engine: true,
      outcomes: true,
      ui: true,
    })

    expect(resolveOpportunityCanaryFlags('8', {
      OPPORTUNITY_ENGINE_V1_ENABLED: 'TRUE',
      OPPORTUNITY_OUTCOMES_ENABLED: '1',
      OPPORTUNITY_OUTCOMES_UI_ENABLED: ' true ',
    })).toEqual({
      engine: false,
      outcomes: false,
      ui: false,
    })
  })

  it('allows pre-activation validation only with a fully dark rollout', () => {
    const disabled = {
      OPPORTUNITY_ENGINE_V1_ENABLED: 'false',
      OPPORTUNITY_OUTCOMES_ENABLED: 'false',
      OPPORTUNITY_OUTCOMES_UI_ENABLED: 'false',
      OPPORTUNITY_OUTCOMES_EXTERNAL_INGEST_ENABLED: 'false',
      OPPORTUNITY_CANARY_OWNER_IDS: '',
    }

    expect(isOpportunityCanaryActivationReady(
      '7',
      'pre_activation',
      disabled,
    )).toBe(true)
    expect(isOpportunityCanaryActivationReady(
      '7',
      'pre_activation',
      { ...disabled, OPPORTUNITY_CANARY_OWNER_IDS: '7' },
    )).toBe(false)
    expect(isOpportunityCanaryActivationReady(
      '7',
      'pre_activation',
      { ...disabled, OPPORTUNITY_ENGINE_V1_ENABLED: 'true' },
    )).toBe(false)
  })

  it('allows active validation only for one exact owner with global flags false', () => {
    const active = {
      OPPORTUNITY_ENGINE_V1_ENABLED: 'false',
      OPPORTUNITY_OUTCOMES_ENABLED: 'false',
      OPPORTUNITY_OUTCOMES_UI_ENABLED: 'false',
      OPPORTUNITY_OUTCOMES_EXTERNAL_INGEST_ENABLED: 'false',
      OPPORTUNITY_CANARY_OWNER_IDS: '7',
    }

    expect(isOpportunityCanaryActivationReady('7', 'active', active)).toBe(true)
    expect(isOpportunityCanaryActivationReady(
      '7',
      'active',
      { ...active, OPPORTUNITY_CANARY_OWNER_IDS: '7,8' },
    )).toBe(false)
    expect(isOpportunityCanaryActivationReady(
      '7',
      'active',
      { ...active, OPPORTUNITY_CANARY_OWNER_IDS: '7,invalid' },
    )).toBe(false)
    expect(isOpportunityCanaryActivationReady(
      '7',
      'active',
      { ...active, OPPORTUNITY_OUTCOMES_ENABLED: 'true' },
    )).toBe(false)
    expect(isOpportunityCanaryActivationReady(
      '7',
      'active',
      { ...active, OPPORTUNITY_OUTCOMES_EXTERNAL_INGEST_ENABLED: 'true' },
    )).toBe(false)
  })

  it('supports one exact workspace canary while keeping all global flags false', () => {
    const active = {
      OPPORTUNITY_ENGINE_V1_ENABLED: 'false',
      OPPORTUNITY_OUTCOMES_ENABLED: 'false',
      OPPORTUNITY_OUTCOMES_UI_ENABLED: 'false',
      OPPORTUNITY_OUTCOMES_EXTERNAL_INGEST_ENABLED: 'false',
      OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED: 'false',
      OPPORTUNITY_CANARY_OWNER_IDS: '',
      OPPORTUNITY_CANARY_WORKSPACE_IDS: '9',
    }

    expect(resolveOpportunityCanaryFlags('7', active, '9')).toEqual({
      engine: true,
      outcomes: true,
      ui: true,
    })
    expect(isOpportunityCanaryActivationReady(
      '7',
      'active',
      active,
      '9',
    )).toBe(true)
    expect(isOpportunityCanaryActivationReady(
      '7',
      'pre_activation',
      active,
      '9',
    )).toBe(false)
    expect(resolveOpportunityCanaryFlags('7', active, '8')).toEqual({
      engine: false,
      outcomes: false,
      ui: false,
    })
  })
})
