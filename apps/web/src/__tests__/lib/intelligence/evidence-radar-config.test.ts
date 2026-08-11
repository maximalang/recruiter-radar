import {
  isEvidenceRadarV1EnabledForContext,
  parseEvidenceRadarCanaryWorkspaceIds,
} from '@/lib/intelligence/evidence-radar-config'

const prerequisiteEnv = {
  OPPORTUNITY_ENGINE_V1_ENABLED: 'true',
} as const

const context = { dataOwnerId: '1', workspaceId: '42' }

describe('Evidence Radar rollout gate', () => {
  it('stays dark by default when its base prerequisite is enabled', () => {
    expect(isEvidenceRadarV1EnabledForContext(context, prerequisiteEnv)).toBe(false)
  })

  it('allows an explicit global enable only after the base Opportunity context is enabled', () => {
    expect(isEvidenceRadarV1EnabledForContext(context, {
      ...prerequisiteEnv,
      EVIDENCE_RADAR_V1_ENABLED: 'true',
    })).toBe(true)
    expect(isEvidenceRadarV1EnabledForContext(context, {
      EVIDENCE_RADAR_V1_ENABLED: 'true',
    })).toBe(false)
  })

  it('does not inherit unrelated Outcome Ledger, workspace-reader, or Commercial Signal UI gates', () => {
    const env = {
      ...prerequisiteEnv,
      OPPORTUNITY_OUTCOMES_ENABLED: 'false',
      OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED: 'false',
      OPPORTUNITY_COMMERCIAL_SIGNAL_UI_ENABLED: 'false',
      EVIDENCE_RADAR_V1_ENABLED: 'true',
    }

    expect(isEvidenceRadarV1EnabledForContext(context, env)).toBe(true)
  })

  it('remains disabled when the base Opportunity context is unavailable', () => {
    expect(isEvidenceRadarV1EnabledForContext(context, {
      EVIDENCE_RADAR_V1_ENABLED: 'true',
    })).toBe(false)
  })

  it('supports workspace canary rollout without enabling other workspaces', () => {
    const env = {
      ...prerequisiteEnv,
      EVIDENCE_RADAR_V1_CANARY_WORKSPACE_IDS: '7,42, 42, invalid,0,-1',
    }
    expect(isEvidenceRadarV1EnabledForContext(context, env)).toBe(true)
    expect(isEvidenceRadarV1EnabledForContext(
      { dataOwnerId: '1', workspaceId: '43' },
      env,
    )).toBe(false)
    expect([...parseEvidenceRadarCanaryWorkspaceIds(env.EVIDENCE_RADAR_V1_CANARY_WORKSPACE_IDS)])
      .toEqual(['7', '42'])
  })

  it('never enables a context without a workspace id', () => {
    expect(isEvidenceRadarV1EnabledForContext(
      { dataOwnerId: '1', workspaceId: null },
      { ...prerequisiteEnv, EVIDENCE_RADAR_V1_ENABLED: 'true' },
    )).toBe(false)
  })
})
