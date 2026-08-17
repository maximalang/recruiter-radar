/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react'

import { OpportunityFunnel } from '@/app/opportunities/opportunity-funnel'

describe('OpportunityFunnel', () => {
  it('shows absolute counts and does not overstate a small sample', () => {
    render(<OpportunityFunnel summary={{
      period: {
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-07-27T00:00:00.000Z',
      },
      cohort: {
        eventType: 'shown',
        policy: 'first_effective_event_ever_closed_window',
        downstreamBefore: '2026-07-27T00:00:00.000Z',
        size: 4,
        cohortAgeDays: 26,
        observationWindowDays: 26,
        matured: false,
        maturityThresholdDays: 30,
      },
      minimumConversionSample: 10,
      effectiveActivityCounts: [
        {
          eventType: 'shown',
          label: 'Показано',
          eventCount: 7,
          opportunityCount: 4,
        },
        {
          eventType: 'opened',
          label: 'Открыто',
          eventCount: 3,
          opportunityCount: 3,
        },
      ],
      ledgerActivityCounts: [],
      correctionsCount: 0,
      cohortCounts: [
        { eventType: 'shown', label: 'Показано', count: 4 },
        { eventType: 'opened', label: 'Открыто', count: 3 },
      ],
      conversions: [{
        from: 'shown',
        to: 'opened',
        sampleSize: 4,
        converted: 3,
        rate: null,
        medianHours: null,
        status: 'insufficient_data',
        sampleStatus: 'insufficient_data',
        maturityStatus: 'immature',
      }],
      terminalOutcomes: {
        won: 0,
        lost: 0,
        completed: 0,
        winRate: null,
        status: 'insufficient_data',
        denominator: 'effective_won_plus_lost',
      },
    }} />)

    expect(screen.getByText('Показано')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getAllByText('Недостаточно данных')).toHaveLength(2)
    expect(screen.getAllByText('Незрелая когорта', { exact: false }))
      .toHaveLength(2)
    expect(screen.getByText(
      'Показано 7 раз · 4 ситуации',
      { exact: false },
    )).toBeInTheDocument()
    expect(screen.queryByText('75%')).toBeNull()
  })
})
