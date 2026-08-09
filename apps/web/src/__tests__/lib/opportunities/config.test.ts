import {
  clampOpportunityJobBatchSize,
  clampCompanyEventsJobBatchSize,
  clampCompanyStateJobBatchSize,
  clampSignalEpisodesJobBatchSize,
  clampCommercialThesisJobBatchSize,
  clampExternalAgencyPropensityJobBatchSize,
  clampAgencyDnaMatchJobBatchSize,
  clampOpportunityScoringV3JobBatchSize,
  clampOpportunityPageSize,
  clampOpportunitySnoozeDays,
  isCompanyEventsV1Enabled,
  isCompanyStateV1Enabled,
  isSignalEpisodesV2Enabled,
  isCommercialThesisV1Enabled,
  isExternalAgencyPropensityV1Enabled,
  isAgencyDnaMatchV2Enabled,
  isOpportunityScoringV3Enabled,
  isCommercialSignalQualityV2Enabled,
  isCommercialSignalQualityV2PlannerFeedbackEnabled,
  isOpportunityCommercialSignalUiEnabledForContext,
  isAgencyDnaV1Enabled,
  isAgencyDnaV1EnabledForContext,
  isOpportunityEngineV1Enabled,
  isOpportunityEngineV1EnabledForContext,
  isOpportunityEngineV1EnabledForOwner,
  isOpportunityAnalyticsV2Enabled,
  isOpportunityAnalyticsV2EnabledForContext,
  isOpportunityOutcomesEnabled,
  isOpportunityOutcomesEnabledForContext,
  isOpportunityOutcomesEnabledForOwner,
  isOpportunityOutcomesExternalIngestEnabled,
  isOpportunityOutcomesUiEnabled,
  isOpportunityOutcomesUiEnabledForContext,
  isOpportunityOutcomesUiEnabledForOwner,
  isOpportunityCrmBridgePublicCallbackEnabled,
  isOpportunityScoringV2Enabled,
  isOpportunityScoringV2EnabledForContext,
  isOpportunityScoringV2ShadowEnabledForContext,
  isOpportunityStrategistV1Enabled,
  isOpportunityStrategistV1EnabledForContext,
  isOpportunityWorkspaceContextEnabled,
  isOpportunityWorkspaceContextEnabledForContext,
  isOpportunityWorkflowV1Enabled,
  isOpportunityWorkflowV1EnabledForContext,
} from '@/lib/opportunities/config'

describe('opportunity engine config', () => {
  it('keeps Commercial Signal Quality v2 independently dark', () => {
    expect(isCommercialSignalQualityV2Enabled({})).toBe(false)
    expect(isCommercialSignalQualityV2Enabled({
      COMMERCIAL_SIGNAL_QUALITY_V2_ENABLED: '1',
    })).toBe(false)
    expect(isCommercialSignalQualityV2Enabled({
      COMMERCIAL_SIGNAL_QUALITY_V2_ENABLED: 'true',
    })).toBe(true)
    expect(isCommercialSignalQualityV2Enabled({
      COMMERCIAL_SIGNAL_QUALITY_V2_ENABLED: ' TRUE ',
    })).toBe(false)
  })

  it('keeps quality planner feedback separately and exactly dark', () => {
    expect(isCommercialSignalQualityV2PlannerFeedbackEnabled({
      COMMERCIAL_SIGNAL_QUALITY_V2_ENABLED: 'true',
    })).toBe(false)
    expect(isCommercialSignalQualityV2PlannerFeedbackEnabled({
      COMMERCIAL_SIGNAL_QUALITY_V2_PLANNER_FEEDBACK_ENABLED: '1',
    })).toBe(false)
    expect(isCommercialSignalQualityV2PlannerFeedbackEnabled({
      COMMERCIAL_SIGNAL_QUALITY_V2_PLANNER_FEEDBACK_ENABLED: 'true',
    })).toBe(true)
  })

  it('keeps Opportunity Scoring v3 independently dark and tightly bounded', () => {
    expect(isOpportunityScoringV3Enabled({})).toBe(false)
    expect(isOpportunityScoringV3Enabled({
      OPPORTUNITY_SCORING_V3_ENABLED: '1',
    })).toBe(false)
    expect(isOpportunityScoringV3Enabled({
      OPPORTUNITY_SCORING_V3_ENABLED: 'true',
    })).toBe(true)
    expect(isOpportunityScoringV3Enabled({
      OPPORTUNITY_SCORING_V3_ENABLED: ' TRUE ',
    })).toBe(false)
    expect(clampOpportunityScoringV3JobBatchSize(Number.NaN)).toBe(10)
    expect(clampOpportunityScoringV3JobBatchSize(0)).toBe(1)
    expect(clampOpportunityScoringV3JobBatchSize(26)).toBe(25)
  })

  it('keeps Commercial Signal UI dark until every tenant-safe prerequisite is on', () => {
    const context = { dataOwnerId: '7', workspaceId: '9' }
    const enabled = {
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
    }

    expect(isOpportunityCommercialSignalUiEnabledForContext(context, {}))
      .toBe(false)
    expect(isOpportunityCommercialSignalUiEnabledForContext(context, enabled))
      .toBe(true)
    expect(isOpportunityCommercialSignalUiEnabledForContext(
      { dataOwnerId: '7', workspaceId: null },
      enabled,
    )).toBe(false)
    for (const missing of Object.keys(enabled)) {
      expect(isOpportunityCommercialSignalUiEnabledForContext(context, {
        ...enabled,
        [missing]: 'false',
      })).toBe(false)
    }
  })

  it('keeps Company Events v1 dark unless the flag is exactly true', () => {
    expect(isCompanyEventsV1Enabled({})).toBe(false)
    expect(isCompanyEventsV1Enabled({ COMPANY_EVENTS_V1_ENABLED: '1' }))
      .toBe(false)
    expect(isCompanyEventsV1Enabled({ COMPANY_EVENTS_V1_ENABLED: 'true' }))
      .toBe(true)
    expect(isCompanyEventsV1Enabled({ COMPANY_EVENTS_V1_ENABLED: ' TRUE ' }))
      .toBe(false)
  })

  it('clamps Company Events cron batches to the smaller safe range', () => {
    expect(clampCompanyEventsJobBatchSize(Number.NaN)).toBe(10)
    expect(clampCompanyEventsJobBatchSize(0)).toBe(1)
    expect(clampCompanyEventsJobBatchSize(26)).toBe(25)
  })

  it('keeps Company State v1 independently dark and tightly bounded', () => {
    expect(isCompanyStateV1Enabled({})).toBe(false)
    expect(isCompanyStateV1Enabled({ COMPANY_STATE_V1_ENABLED: '1' }))
      .toBe(false)
    expect(isCompanyStateV1Enabled({ COMPANY_STATE_V1_ENABLED: 'true' }))
      .toBe(true)
    expect(isCompanyStateV1Enabled({ COMPANY_STATE_V1_ENABLED: ' TRUE ' }))
      .toBe(false)
    expect(clampCompanyStateJobBatchSize(Number.NaN)).toBe(10)
    expect(clampCompanyStateJobBatchSize(0)).toBe(1)
    expect(clampCompanyStateJobBatchSize(26)).toBe(25)
  })

  it('keeps Signal Episodes v2 independently dark and tightly bounded', () => {
    expect(isSignalEpisodesV2Enabled({})).toBe(false)
    expect(isSignalEpisodesV2Enabled({ SIGNAL_EPISODES_V2_ENABLED: '1' }))
      .toBe(false)
    expect(isSignalEpisodesV2Enabled({ SIGNAL_EPISODES_V2_ENABLED: 'true' }))
      .toBe(true)
    expect(isSignalEpisodesV2Enabled({ SIGNAL_EPISODES_V2_ENABLED: ' TRUE ' }))
      .toBe(false)
    expect(clampSignalEpisodesJobBatchSize(Number.NaN)).toBe(10)
    expect(clampSignalEpisodesJobBatchSize(0)).toBe(1)
    expect(clampSignalEpisodesJobBatchSize(26)).toBe(25)
  })

  it('keeps Commercial Thesis v1 independently dark and tightly bounded', () => {
    expect(isCommercialThesisV1Enabled({})).toBe(false)
    expect(isCommercialThesisV1Enabled({ COMMERCIAL_THESIS_V1_ENABLED: '1' }))
      .toBe(false)
    expect(isCommercialThesisV1Enabled({
      COMMERCIAL_THESIS_V1_ENABLED: 'true',
    })).toBe(true)
    expect(isCommercialThesisV1Enabled({
      COMMERCIAL_THESIS_V1_ENABLED: ' TRUE ',
    })).toBe(false)
    expect(clampCommercialThesisJobBatchSize(Number.NaN)).toBe(10)
    expect(clampCommercialThesisJobBatchSize(0)).toBe(1)
    expect(clampCommercialThesisJobBatchSize(26)).toBe(25)
  })

  it('keeps External Agency Propensity v1 independently dark and bounded', () => {
    expect(isExternalAgencyPropensityV1Enabled({})).toBe(false)
    expect(isExternalAgencyPropensityV1Enabled({
      EXTERNAL_AGENCY_PROPENSITY_V1_ENABLED: '1',
    })).toBe(false)
    expect(isExternalAgencyPropensityV1Enabled({
      EXTERNAL_AGENCY_PROPENSITY_V1_ENABLED: 'true',
    })).toBe(true)
    expect(isExternalAgencyPropensityV1Enabled({
      EXTERNAL_AGENCY_PROPENSITY_V1_ENABLED: ' TRUE ',
    })).toBe(false)
    expect(clampExternalAgencyPropensityJobBatchSize(Number.NaN)).toBe(10)
    expect(clampExternalAgencyPropensityJobBatchSize(0)).toBe(1)
    expect(clampExternalAgencyPropensityJobBatchSize(26)).toBe(25)
  })

  it('keeps Agency DNA Match v2 independently dark and bounded', () => {
    expect(isAgencyDnaMatchV2Enabled({})).toBe(false)
    expect(isAgencyDnaMatchV2Enabled({ AGENCY_DNA_MATCH_V2_ENABLED: '1' }))
      .toBe(false)
    expect(isAgencyDnaMatchV2Enabled({ AGENCY_DNA_MATCH_V2_ENABLED: 'true' }))
      .toBe(true)
    expect(isAgencyDnaMatchV2Enabled({
      AGENCY_DNA_MATCH_V2_ENABLED: ' TRUE ',
    })).toBe(false)
    expect(clampAgencyDnaMatchJobBatchSize(Number.NaN)).toBe(10)
    expect(clampAgencyDnaMatchJobBatchSize(0)).toBe(1)
    expect(clampAgencyDnaMatchJobBatchSize(26)).toBe(25)
  })

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

  it('requires every global tenant boundary before exposing the public CRM callback', () => {
    const enabled = {
      OPPORTUNITY_ENGINE_V1_ENABLED: 'true',
      OPPORTUNITY_OUTCOMES_ENABLED: 'true',
      OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED: 'true',
      OPPORTUNITY_CRM_BRIDGE_ENABLED: 'true',
    }
    expect(isOpportunityCrmBridgePublicCallbackEnabled(enabled)).toBe(true)
    for (const missing of Object.keys(enabled)) {
      expect(isOpportunityCrmBridgePublicCallbackEnabled({
        ...enabled,
        [missing]: 'false',
      })).toBe(false)
    }
  })

  it('exposes the public CRM callback for one exact workspace canary only', () => {
    expect(isOpportunityCrmBridgePublicCallbackEnabled({
      OPPORTUNITY_CANARY_WORKSPACE_IDS: '9',
      OPPORTUNITY_CRM_BRIDGE_ENABLED: 'true',
    })).toBe(true)
    for (const invalid of ['9,10', '9,9', '09', '*', '']) {
      expect(isOpportunityCrmBridgePublicCallbackEnabled({
        OPPORTUNITY_CANARY_WORKSPACE_IDS: invalid,
        OPPORTUNITY_CRM_BRIDGE_ENABLED: 'true',
      })).toBe(false)
    }
    expect(isOpportunityCrmBridgePublicCallbackEnabled({
      OPPORTUNITY_CANARY_OWNER_IDS: '7',
      OPPORTUNITY_CANARY_WORKSPACE_IDS: '9',
      OPPORTUNITY_CRM_BRIDGE_ENABLED: 'true',
    })).toBe(false)
  })

  it('keeps analytics v2 dark and requires every workspace ledger boundary', () => {
    const context = { dataOwnerId: '7', workspaceId: '9' }
    const enabled = {
      OPPORTUNITY_ENGINE_V1_ENABLED: 'true',
      OPPORTUNITY_OUTCOMES_ENABLED: 'true',
      OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED: 'true',
      OPPORTUNITY_ANALYTICS_V2_ENABLED: 'true',
    }

    expect(isOpportunityAnalyticsV2Enabled({})).toBe(false)
    expect(isOpportunityAnalyticsV2Enabled({
      OPPORTUNITY_ANALYTICS_V2_ENABLED: ' TRUE ',
    })).toBe(false)
    expect(isOpportunityAnalyticsV2EnabledForContext(context, enabled)).toBe(true)
    expect(isOpportunityAnalyticsV2EnabledForContext(
      { dataOwnerId: '7', workspaceId: null },
      enabled,
    )).toBe(false)

    for (const missing of Object.keys(enabled)) {
      expect(isOpportunityAnalyticsV2EnabledForContext(context, {
        ...enabled,
        [missing]: 'false',
      })).toBe(false)
    }
  })

  it('keeps daily workflow dark and requires the workspace ledger boundary', () => {
    const context = { dataOwnerId: '7', workspaceId: '9' }

    expect(isOpportunityWorkflowV1Enabled({})).toBe(false)
    expect(isOpportunityWorkflowV1Enabled({
      OPPORTUNITY_WORKFLOW_V1_ENABLED: ' TRUE ',
    })).toBe(false)
    expect(isOpportunityWorkflowV1EnabledForContext(context, {
      OPPORTUNITY_WORKFLOW_V1_ENABLED: 'true',
    })).toBe(false)
    expect(isOpportunityWorkflowV1EnabledForContext(context, {
      OPPORTUNITY_ENGINE_V1_ENABLED: 'true',
      OPPORTUNITY_OUTCOMES_ENABLED: 'true',
      OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED: 'true',
      OPPORTUNITY_WORKFLOW_V1_ENABLED: 'true',
    })).toBe(true)
  })

  it('accepts one exact workflow workspace canary without broad activation', () => {
    const prerequisites = {
      OPPORTUNITY_CANARY_WORKSPACE_IDS: '9',
      OPPORTUNITY_WORKFLOW_V1_CANARY_WORKSPACE_IDS: '9',
    }

    expect(isOpportunityWorkflowV1EnabledForContext(
      { dataOwnerId: '7', workspaceId: '9' },
      prerequisites,
    )).toBe(true)
    expect(isOpportunityWorkflowV1EnabledForContext(
      { dataOwnerId: '7', workspaceId: '10' },
      prerequisites,
    )).toBe(false)
    expect(isOpportunityWorkflowV1EnabledForContext(
      { dataOwnerId: '7', workspaceId: null },
      prerequisites,
    )).toBe(false)

    for (const invalid of ['9,10', '9,9', '09', '*', '']) {
      expect(isOpportunityWorkflowV1EnabledForContext(
        { dataOwnerId: '7', workspaceId: '9' },
        {
          OPPORTUNITY_CANARY_WORKSPACE_IDS: '9',
          OPPORTUNITY_WORKFLOW_V1_CANARY_WORKSPACE_IDS: invalid,
        },
      )).toBe(false)
    }
  })

  it('keeps Agency DNA v1 fail-closed with a phase-specific workspace canary', () => {
    const context = { dataOwnerId: '7', workspaceId: '9' }

    expect(isAgencyDnaV1Enabled({})).toBe(false)
    expect(isAgencyDnaV1Enabled({ AGENCY_DNA_V1_ENABLED: ' TRUE ' })).toBe(false)
    expect(isAgencyDnaV1Enabled({ AGENCY_DNA_V1_ENABLED: 'true' })).toBe(true)
    expect(isAgencyDnaV1EnabledForContext(context, {})).toBe(false)
    expect(isAgencyDnaV1EnabledForContext(context, {
      OPPORTUNITY_CANARY_WORKSPACE_IDS: '9',
      AGENCY_DNA_V1_CANARY_WORKSPACE_IDS: '9',
    })).toBe(true)

    for (const invalid of ['9,10', '09', '*', '']) {
      expect(isAgencyDnaV1EnabledForContext(context, {
        OPPORTUNITY_CANARY_WORKSPACE_IDS: '9',
        AGENCY_DNA_V1_CANARY_WORKSPACE_IDS: invalid,
      })).toBe(false)
    }
    expect(isAgencyDnaV1EnabledForContext(
      { dataOwnerId: '7', workspaceId: null },
      {
        OPPORTUNITY_CANARY_WORKSPACE_IDS: '9',
        AGENCY_DNA_V1_CANARY_WORKSPACE_IDS: '9',
      },
    )).toBe(false)
    expect(isAgencyDnaV1EnabledForContext(context, {
      AGENCY_DNA_V1_ENABLED: 'true',
    })).toBe(false)
    expect(isAgencyDnaV1EnabledForContext(
      { dataOwnerId: null, workspaceId: null },
      {
        OPPORTUNITY_ENGINE_V1_ENABLED: 'true',
        OPPORTUNITY_OUTCOMES_ENABLED: 'true',
        OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED: 'true',
        AGENCY_DNA_V1_ENABLED: 'true',
      },
    )).toBe(true)
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
      OPPORTUNITY_CANARY_WORKSPACE_IDS: '9',
      AGENCY_DNA_V1_CANARY_WORKSPACE_IDS: '9',
      OPPORTUNITY_SCORING_V2_CANARY_WORKSPACE_IDS: '9',
    })).toBe(true)
    expect(isOpportunityScoringV2EnabledForContext(context, {
      OPPORTUNITY_ENGINE_V1_ENABLED: 'true',
      OPPORTUNITY_OUTCOMES_ENABLED: 'true',
      OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED: 'true',
      AGENCY_DNA_V1_ENABLED: 'true',
      OPPORTUNITY_SCORING_V2_ENABLED: 'true',
    })).toBe(true)
  })

  it('rejects malformed or cross-workspace Scoring v2 canaries', () => {
    const context = { dataOwnerId: '7', workspaceId: '9' }
    const agencyDna = {
      OPPORTUNITY_CANARY_WORKSPACE_IDS: '9',
      AGENCY_DNA_V1_CANARY_WORKSPACE_IDS: '9',
    }

    for (const invalid of ['9,10', '9,9', '09', '*', '']) {
      expect(isOpportunityScoringV2EnabledForContext(context, {
        ...agencyDna,
        OPPORTUNITY_SCORING_V2_CANARY_WORKSPACE_IDS: invalid,
      })).toBe(false)
    }
    expect(isOpportunityScoringV2EnabledForContext(
      { dataOwnerId: '7', workspaceId: '10' },
      {
        OPPORTUNITY_CANARY_WORKSPACE_IDS: '9',
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
      OPPORTUNITY_CANARY_WORKSPACE_IDS: '9',
      AGENCY_DNA_V1_CANARY_WORKSPACE_IDS: '9',
      OPPORTUNITY_SCORING_V2_SHADOW_CANARY_WORKSPACE_IDS: '9',
    })).toBe(true)
    expect(isOpportunityScoringV2EnabledForContext(context, {
      OPPORTUNITY_CANARY_WORKSPACE_IDS: '9',
      AGENCY_DNA_V1_CANARY_WORKSPACE_IDS: '9',
      OPPORTUNITY_SCORING_V2_SHADOW_CANARY_WORKSPACE_IDS: '9',
    })).toBe(false)

    for (const invalid of ['9,10', '9,9', '09', '*', '']) {
      expect(isOpportunityScoringV2ShadowEnabledForContext(context, {
        OPPORTUNITY_CANARY_WORKSPACE_IDS: '9',
        AGENCY_DNA_V1_CANARY_WORKSPACE_IDS: '9',
        OPPORTUNITY_SCORING_V2_SHADOW_CANARY_WORKSPACE_IDS: invalid,
      })).toBe(false)
    }
  })

  it('keeps Strategist v1 fail-closed and requires Agency DNA in the same workspace', () => {
    const context = { dataOwnerId: '7', workspaceId: '9' }

    expect(isOpportunityStrategistV1Enabled({})).toBe(false)
    expect(isOpportunityStrategistV1Enabled({
      OPPORTUNITY_STRATEGIST_V1_ENABLED: ' TRUE ',
    })).toBe(false)
    expect(isOpportunityStrategistV1EnabledForContext(context, {
      OPPORTUNITY_STRATEGIST_V1_CANARY_WORKSPACE_IDS: '9',
    })).toBe(false)
    expect(isOpportunityStrategistV1EnabledForContext(context, {
      OPPORTUNITY_CANARY_WORKSPACE_IDS: '9',
      AGENCY_DNA_V1_CANARY_WORKSPACE_IDS: '9',
      OPPORTUNITY_STRATEGIST_V1_CANARY_WORKSPACE_IDS: '9',
    })).toBe(true)
    expect(isOpportunityStrategistV1EnabledForContext(context, {
      OPPORTUNITY_ENGINE_V1_ENABLED: 'true',
      OPPORTUNITY_OUTCOMES_ENABLED: 'true',
      OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED: 'true',
      AGENCY_DNA_V1_ENABLED: 'true',
      OPPORTUNITY_STRATEGIST_V1_ENABLED: 'true',
    })).toBe(true)
  })

  it('rejects malformed or cross-workspace Strategist v1 canaries', () => {
    const context = { dataOwnerId: '7', workspaceId: '9' }
    const agencyDna = {
      OPPORTUNITY_CANARY_WORKSPACE_IDS: '9',
      AGENCY_DNA_V1_CANARY_WORKSPACE_IDS: '9',
    }

    for (const invalid of ['9,10', '9,9', '09', '*', '']) {
      expect(isOpportunityStrategistV1EnabledForContext(context, {
        ...agencyDna,
        OPPORTUNITY_STRATEGIST_V1_CANARY_WORKSPACE_IDS: invalid,
      })).toBe(false)
    }
    expect(isOpportunityStrategistV1EnabledForContext(
      { dataOwnerId: '7', workspaceId: '10' },
      {
        OPPORTUNITY_CANARY_WORKSPACE_IDS: '9',
        AGENCY_DNA_V1_CANARY_WORKSPACE_IDS: '9',
        OPPORTUNITY_STRATEGIST_V1_CANARY_WORKSPACE_IDS: '9',
      },
    )).toBe(false)
  })
})
