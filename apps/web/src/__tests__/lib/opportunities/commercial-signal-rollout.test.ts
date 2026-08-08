import {
  commercialSignalCandidateRolloutMode,
  getCommercialSignalCanaryWorkspaceId,
  isCommercialSignalAuthoritativeForWorkspace,
  resolveCommercialSignalRollout,
} from '@/lib/opportunities/commercial-signal-rollout'

const readyFlags = {
  COMPANY_EVENTS_V1_ENABLED: 'true',
  COMPANY_STATE_V1_ENABLED: 'true',
  SIGNAL_EPISODES_V2_ENABLED: 'true',
  COMMERCIAL_THESIS_V1_ENABLED: 'true',
  EXTERNAL_AGENCY_PROPENSITY_V1_ENABLED: 'true',
  AGENCY_DNA_MATCH_V2_ENABLED: 'true',
  OPPORTUNITY_SCORING_V3_ENABLED: 'true',
  QUERY_PLANNER_V2_ENABLED: 'true',
} as const

describe('Commercial Signal production rollout', () => {
  it('defaults to legacy on absent or malformed mode', () => {
    expect(resolveCommercialSignalRollout('10', {})).toMatchObject({
      requestedMode: 'legacy',
      effectiveMode: 'legacy',
      reasonCode: 'legacy_default',
    })
    expect(resolveCommercialSignalRollout('10', {
      COMMERCIAL_SIGNAL_RUNTIME_MODE: 'enabled',
    })).toMatchObject({
      requestedMode: 'legacy',
      effectiveMode: 'legacy',
    })
  })

  it('keeps shadow non-authoritative', () => {
    const env = {
      ...readyFlags,
      COMMERCIAL_SIGNAL_RUNTIME_MODE: 'shadow',
    }
    expect(resolveCommercialSignalRollout('10', env)).toMatchObject({
      effectiveMode: 'shadow',
      reasonCode: 'shadow_enabled',
    })
    expect(isCommercialSignalAuthoritativeForWorkspace('10', env)).toBe(false)
    expect(commercialSignalCandidateRolloutMode('10', env)).toBe('shadow')
  })

  it('allows exactly one canary workspace and leaves every other tenant legacy', () => {
    const env = {
      ...readyFlags,
      COMMERCIAL_SIGNAL_RUNTIME_MODE: 'canary',
      COMMERCIAL_SIGNAL_CANARY_WORKSPACE_IDS: '20',
    }
    expect(resolveCommercialSignalRollout('20', env)).toMatchObject({
      effectiveMode: 'canary',
      reasonCode: 'canary_workspace_match',
      canaryWorkspaceId: '20',
    })
    expect(resolveCommercialSignalRollout('21', env)).toMatchObject({
      effectiveMode: 'legacy',
      reasonCode: 'canary_workspace_mismatch',
    })
    expect(isCommercialSignalAuthoritativeForWorkspace('20', env)).toBe(true)
    expect(isCommercialSignalAuthoritativeForWorkspace('21', env)).toBe(false)
    expect(commercialSignalCandidateRolloutMode('20', env)).toBe('canary')
    expect(commercialSignalCandidateRolloutMode('21', env)).toBe('shadow')
  })

  it('fails closed when canary scope is absent, invalid, or contains multiple workspaces', () => {
    for (const scope of ['', '0', '20,21', 'workspace']) {
      const env = {
        ...readyFlags,
        COMMERCIAL_SIGNAL_RUNTIME_MODE: 'canary',
        COMMERCIAL_SIGNAL_CANARY_WORKSPACE_IDS: scope,
      }
      expect(resolveCommercialSignalRollout('20', env)).toMatchObject({
        effectiveMode: 'legacy',
        reasonCode: 'canary_scope_invalid',
      })
      expect(getCommercialSignalCanaryWorkspaceId(env)).toBeNull()
    }
  })

  it('fails back to legacy when any upstream prerequisite is off', () => {
    const env = {
      ...readyFlags,
      COMMERCIAL_SIGNAL_RUNTIME_MODE: 'canary',
      COMMERCIAL_SIGNAL_CANARY_WORKSPACE_IDS: '20',
      SIGNAL_EPISODES_V2_ENABLED: 'false',
    }
    expect(resolveCommercialSignalRollout('20', env)).toMatchObject({
      effectiveMode: 'legacy',
      prerequisitesReady: false,
      reasonCode: 'prerequisite_flag_off',
      missingFlags: ['SIGNAL_EPISODES_V2_ENABLED'],
    })
  })

  it('fails closed when global commercial_signal rollout is requested', () => {
    const env = {
      ...readyFlags,
      COMMERCIAL_SIGNAL_RUNTIME_MODE: 'commercial_signal',
    }
    expect(resolveCommercialSignalRollout('20', env)).toMatchObject({
      requestedMode: 'legacy',
      effectiveMode: 'legacy',
      reasonCode: 'legacy_default',
    })
    expect(isCommercialSignalAuthoritativeForWorkspace('20', env)).toBe(false)
    expect(commercialSignalCandidateRolloutMode('20', env)).toBe('shadow')
  })
})
