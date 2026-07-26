import {
  clampOpportunityJobBatchSize,
  clampOpportunityPageSize,
  clampOpportunitySnoozeDays,
  isOpportunityEngineV1Enabled,
} from '@/lib/opportunities/config'

describe('opportunity engine config', () => {
  it('is dark by default and only accepts an explicit true value', () => {
    expect(isOpportunityEngineV1Enabled({})).toBe(false)
    expect(isOpportunityEngineV1Enabled({ OPPORTUNITY_ENGINE_V1_ENABLED: '1' })).toBe(false)
    expect(isOpportunityEngineV1Enabled({ OPPORTUNITY_ENGINE_V1_ENABLED: ' TRUE ' })).toBe(true)
  })

  it('clamps user and job controlled limits', () => {
    expect(clampOpportunityPageSize(0)).toBe(1)
    expect(clampOpportunityPageSize(1_000)).toBe(100)
    expect(clampOpportunityJobBatchSize(0)).toBe(1)
    expect(clampOpportunityJobBatchSize(1_000)).toBe(500)
    expect(clampOpportunitySnoozeDays(undefined)).toBe(7)
    expect(clampOpportunitySnoozeDays(1_000)).toBe(90)
  })
})
