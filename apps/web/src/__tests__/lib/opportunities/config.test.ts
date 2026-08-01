import {
  clampOpportunityJobBatchSize,
  clampOpportunityPageSize,
  clampOpportunitySnoozeDays,
  isAgencyDnaV1Enabled,
  isAgencyDnaV1EnabledForContext,
  isOpportunityEngineV1Enabled,
  isOpportunityEngineV1EnabledForContext,
  isOpportunityEngineV1EnabledForOwner,
  isOpportunityOutcomesEnabled,
  isOpportunityOutcomesEnabledForContext,
  isOpportunityOutcomesEnabledForOwner,
  isOpportunityOutcomesExternalIngestEnabled,
  isOpportunityOutcomesUiEnabled,
  isOpportunityOutcomesUiEnabledForContext,
  isOpportunityOutcomesUiEnabledForOwner,
  isOpportunityScoringV2Enabled,
  isOpportunityScoringV2EnabledForContext,
  isOpportunityScoringV2ShadowEnabledForContext,
  isOpportunityWorkspaceContextEnabled,
  isOpportunityWorkspaceContextEnabledForContext,
} from '@/lib/opportunities/config'

describe('opportunity engine config', () => {
  it('is dark by default and only accepts an explicit true value', () => {
    expect(isOpportunityEngineV1Enabled({})).toBe(false)
    expect(isOpportunityEngineV1Enabled({ OPPORTUNITY_ENGINE_V1_ENABLED: '1' })).toBe(false)
    expect(isOpportunityEngineV1Enabled({ OPPORTUNITY_ENGINE_V1_ENABLED: 'true' })).toBe(true)
    expect(isOpportunityEngineV1Enabled({ OPPORTUNITY_ENGINE_V1_ENABLED: ' TRUE ' })).toBe(false)
  })

  it('clamps user and job controlled limits', () => {
    expect(clampOpportunityPageSize(0)).toBe(1)
    expect(clampOpportunityPageSize(1_000)).toBe(100)
    expect(clampOpportunityJobBatchSize(0)).toBe(1)
    expect(clampOpportunityJobBatchSize(1_000)).toBe(500)
    expect(clampOpportunitySnoozeDays(undefined)).toBe(7)
    expect(clampOpportunitySnoozeDays(1_000)).toBe(90)
  })

  it('keeps every outcome surface disabled by default', () => {
    expect(isOpportunityOutcomesEnabled({})).toBe(false)
    expect(isOpportunityOutcomesUiEnabled({
      OPPORTUNITY_OUTCOMES_UI_ENABLED: 'true',
    })).toBe(false)
    expect(isOpportunityOutcomesExternalIngestEnabled({
      OPPORTUNITY_OUTCOMES_EXTERNAL_INGEST_ENABLED: 'true',
    })).toBe(false)
  })

  it('requires the ledger for UI and keeps global-secret ingestion blocked', () => {
    const ledger = { OPPORTUNITY_OUTCOMES_ENABLED: 'true' }
    expect(isOpportunityOutcomesEnabled(ledger)).toBe(true)
    expect(isOpportunityOutcomesUiEnabled({
      ...ledger,
      OPPORTUNITY_OUTCOMES_UI_ENABLED: 'true',
    })).toBe(true)
    expect(isOpportunityOutcomesExternalIngestEnabled({
      ...ledger,
      OPPORTUNITY_OUTCOMES_EXTERNAL_INGEST_ENABLED: 'true',
    })).toBe(false)
  })

  it('enables the internal canary only for exact allowlisted owner IDs', () => {
    const canary = {
      OPPORTUNITY_CANARY_OWNER_IDS: '7',
    }

    expect(isOpportunityEngineV1EnabledForOwner('7', canary)).toBe(true)
    expect(isOpportunityOutcomesUiEnabledForOwner('7', canary)).toBe(true)

    expect(isOpportunityEngineV1EnabledForOwner('70', canary)).toBe(false)
    expect(isOpportunityEngineV1EnabledForOwner('07', canary)).toBe(false)
    expect(isOpportunityEngineV1EnabledForOwner(null, canary)).toBe(false)
    expect(isOpportunityOutcomesEnabledForOwner('8', canary)).toBe(false)
    expect(isOpportunityOutcomesUiEnabledForOwner('8', canary)).toBe(false)

    for (const invalid of [
      '7,42',
      '7,7',
      '7,invalid',
      '7,',
      ',7',
      '7,,',
      '*',
      '07',
    ]) {
      expect(isOpportunityEngineV1EnabledForOwner('7', {
        OPPORTUNITY_CANARY_OWNER_IDS: invalid,
      })).toBe(false)
    }
  })

  it('preserves global enablement without allowing malformed owner IDs', () => {
    expect(isOpportunityEngineV1EnabledForOwner(null, {
      OPPORTUNITY_ENGINE_V1_ENABLED: 'true',
    })).toBe(true)
    expect(isOpportunityOutcomesEnabledForOwner('not-an-owner', {
      OPPORTUNITY_ENGINE_V1_ENABLED: 'true',
      OPPORTUNITY_OUTCOMES_ENABLED: 'true',
    })).toBe(true)
    expect(isOpportunityOutcomesUiEnabledForOwner('9', {
      OPPORTUNITY_ENGINE_V1_ENABLED: 'true',
      OPPORTUNITY_OUTCOMES_ENABLED: 'true',
      OPPORTUNITY_OUTCOMES_UI_ENABLED: 'true',
    })).toBe(true)
  })

  it('enables a workspace canary only for one exact workspace identity', () => {
    const context = { dataOwnerId: '7', workspaceId: '9' }
    const canary = {
      OPPORTUNITY_CANARY_WORKSPACE_IDS: '9',
    }

    expect(isOpportunityEngineV1EnabledForContext(context, canary)).toBe(true)
    expect(isOpportunityOutcomesEnabledForContext(context, canary)).toBe(true)
    expect(isOpportunityOutcomesUiEnabledForContext(context, canary)).toBe(true)
    expect(
      isOpportunityWorkspaceContextEnabledForContext(context, canary),
    ).toBe(true)

    expect(isOpportunityEngineV1EnabledForContext(
      { dataOwnerId: '7', workspaceId: '90' },
      canary,
    )).toBe(false)
    expect(isOpportunityEngineV1EnabledForContext(
      { dataOwnerId: '9', workspaceId: null },
      canary,
    )).toBe(false)
  })

  it('fails closed for malformed or ambiguous workspace canary configuration', () => {
    const context = { dataOwnerId: '7', workspaceId: '9' }

    for (const invalid of [
      '9,10',
      '9,9',
      '9,invalid',
      '9,',
      ',9',
      '*',
      '09',
    ]) {
      expect(isOpportunityEngineV1EnabledForContext(context, {
        OPPORTUNITY_CANARY_WORKSPACE_IDS: invalid,
      })).toBe(false)
    }

    expect(isOpportunityEngineV1EnabledForContext(context, {
      OPPORTUNITY_CANARY_OWNER_IDS: '7',
      OPPORTUNITY_CANARY_WORKSPACE_IDS: '9',
    })).toBe(false)
  })

  it('keeps workspace context fail-closed outside an explicit flag or canary', () => {
    const context = { dataOwnerId: '7', workspaceId: '9' }

    expect(isOpportunityWorkspaceContextEnabled({})).toBe(false)
    expect(isOpportunityWorkspaceContextEnabled({
      OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED: ' TRUE ',
    })).toBe(false)
    expect(isOpportunityWorkspaceContextEnabled({
      OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED: 'true',
    })).toBe(true)
    expect(isOpportunityWorkspaceContextEnabledForContext(context, {}))
      .toBe(false)
    expect(isOpportunityWorkspaceContextEnabledForContext(context, {
      OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED: 'true',
    })).toBe(true)
  })

  it('keeps Agency DNA v1 fail-closed with a phase-specific workspace canary', () => {
    const context = { dataOwnerId: '7', workspaceId: '9' }

    expect(isAgencyDnaV1Enabled({})).toBe(false)
    expect(isAgencyDnaV1Enabled({ AGENCY_DNA_V1_ENABLED: ' TRUE ' })).toBe(false)
    expect(isAgencyDnaV1Enabled({ AGENCY_DNA_V1_ENABLED: 'true' })).toBe(true)
    expect(isAgencyDnaV1EnabledForContext(context, {})).toBe(false)
    expect(isAgencyDnaV1EnabledForContext(context, {
      AGENCY_DNA_V1_CANARY_WORKSPACE_IDS: '9',
    })).toBe(true)

    for (const invalid of ['9,10', '09', '*', '']) {
      expect(isAgencyDnaV1EnabledForContext(context, {
        AGENCY_DNA_V1_CANARY_WORKSPACE_IDS: invalid,
      })).toBe(false)
    }
    expect(isAgencyDnaV1EnabledForContext(
      { dataOwnerId: '7', workspaceId: null },
      { AGENCY_DNA_V1_CANARY_WORKSPACE_IDS: '9' },
    )).toBe(false)
  })

  it('keeps Scoring v2 fail-closed and requires Agency DNA in the same workspace', () => {
    const context = { dataOwnerId: '7', workspaceId: '9' }

    expect(isOpportunityScoringV2Enabled({})).toBe(false)
    expect(isOpportunityScoringV2Enabled({
      OPPORTUNITY_SCORING_V2_ENABLED: ' TRUE ',
    })).toBe(false)
    expect(isOpportunityScoringV2EnabledForContext(context, {
      OPPORTUNITY_SCORING_V2_CANARY_WORKSPACE_IDS: '9',
    })).toBe(false)
    expect(isOpportunityScoringV2EnabledForContext(context, {
      AGENCY_DNA_V1_CANARY_WORKSPACE_IDS: '9',
      OPPORTUNITY_SCORING_V2_CANARY_WORKSPACE_IDS: '9',
    })).toBe(true)
    expect(isOpportunityScoringV2EnabledForContext(context, {
      AGENCY_DNA_V1_ENABLED: 'true',
      OPPORTUNITY_SCORING_V2_ENABLED: 'true',
    })).toBe(true)
  })

  it('rejects malformed or cross-workspace Scoring v2 canaries', () => {
    const context = { dataOwnerId: '7', workspaceId: '9' }
    const agencyDna = { AGENCY_DNA_V1_CANARY_WORKSPACE_IDS: '9' }

    for (const invalid of ['9,10', '9,9', '09', '*', '']) {
      expect(isOpportunityScoringV2EnabledForContext(context, {
        ...agencyDna,
        OPPORTUNITY_SCORING_V2_CANARY_WORKSPACE_IDS: invalid,
      })).toBe(false)
    }
    expect(isOpportunityScoringV2EnabledForContext(
      { dataOwnerId: '7', workspaceId: '10' },
      {
        AGENCY_DNA_V1_CANARY_WORKSPACE_IDS: '9',
        OPPORTUNITY_SCORING_V2_CANARY_WORKSPACE_IDS: '9',
      },
    )).toBe(false)
  })

  it('keeps Scoring v2 shadow evaluation fail-closed and separate from activation', () => {
    const context = { dataOwnerId: '7', workspaceId: '9' }

    expect(isOpportunityScoringV2ShadowEnabledForContext(context, {})).toBe(false)
    expect(isOpportunityScoringV2ShadowEnabledForContext(context, {
      OPPORTUNITY_SCORING_V2_SHADOW_CANARY_WORKSPACE_IDS: '9',
    })).toBe(false)
    expect(isOpportunityScoringV2ShadowEnabledForContext(context, {
      AGENCY_DNA_V1_CANARY_WORKSPACE_IDS: '9',
      OPPORTUNITY_SCORING_V2_SHADOW_CANARY_WORKSPACE_IDS: '9',
    })).toBe(true)
    expect(isOpportunityScoringV2EnabledForContext(context, {
      AGENCY_DNA_V1_CANARY_WORKSPACE_IDS: '9',
      OPPORTUNITY_SCORING_V2_SHADOW_CANARY_WORKSPACE_IDS: '9',
    })).toBe(false)

    for (const invalid of ['9,10', '9,9', '09', '*', '']) {
      expect(isOpportunityScoringV2ShadowEnabledForContext(context, {
        AGENCY_DNA_V1_CANARY_WORKSPACE_IDS: '9',
        OPPORTUNITY_SCORING_V2_SHADOW_CANARY_WORKSPACE_IDS: invalid,
      })).toBe(false)
    }
  })
})
