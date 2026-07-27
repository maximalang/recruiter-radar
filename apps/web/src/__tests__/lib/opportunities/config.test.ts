import {
  clampOpportunityJobBatchSize,
  clampOpportunityPageSize,
  clampOpportunitySnoozeDays,
  isOpportunityEngineV1Enabled,
  isOpportunityOutcomesEnabled,
  isOpportunityOutcomesExternalIngestEnabled,
  isOpportunityOutcomesUiEnabled,
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

  it('requires the server ledger before UI or external ingestion', () => {
    const ledger = { OPPORTUNITY_OUTCOMES_ENABLED: 'true' }
    expect(isOpportunityOutcomesEnabled(ledger)).toBe(true)
    expect(isOpportunityOutcomesUiEnabled({
      ...ledger,
      OPPORTUNITY_OUTCOMES_UI_ENABLED: 'true',
    })).toBe(true)
    expect(isOpportunityOutcomesExternalIngestEnabled({
      ...ledger,
      OPPORTUNITY_OUTCOMES_EXTERNAL_INGEST_ENABLED: 'true',
    })).toBe(true)
  })
})
