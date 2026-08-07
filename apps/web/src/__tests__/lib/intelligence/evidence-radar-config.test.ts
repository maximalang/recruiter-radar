import {
  isEvidenceRadarV1EnabledForContext,
  parseEvidenceRadarCanaryWorkspaceIds,
} from '@/lib/intelligence/evidence-radar-config'

const prerequisiteEnv = {
  OPPORTUNITY_ENGINE_V1_ENABLED: 'true',
  OPPORTUNITY_OUTCOMES_ENABLED: 'true',
  OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED: 'true',
  COMPANY_EVENTS_V1_ENABLED: 'true',
  COMPANY_STATE_V1_ENABLED: 'true',
  SIGNAL_EPISODES_V2_ENABLED: 'true',
  COMMERCIAL_THESIS_V1_ENABLED: 'true',
  EXTERNAL_AGENCY_PROPENSITY_V1_ENABLED: 'true',
  AGENCY_DNA_MATCH_V2_ENABLED: 'true',
  OPPORTUNITY_SCORING_V3_ENABLED: 'true',
  OPPORTUNITY_COMMERCIAL_SIGNAL_UI_ENABLED: 'true',
} as const

const context = { dataOwnerId: '1', workspaceId: '42' }

describe('Evidence Radar rollout gate', () => {
  it('stays dark by default even when Commercial Signal UI is enabled', () => {
    expect(isEvidenceRadarV1EnabledForContext(context, prerequisiteEnv)).toBe(false)
  })

  it('allows an explicit global enable only after upstream prerequisites are enabled', () => {
    expect(isEvidenceRadarV1EnabledForContext(context, {
      ...prerequisiteEnv,
      EVIDENCE_RADAR_V1_ENABLED: 'true',
    })).toBe(true)
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