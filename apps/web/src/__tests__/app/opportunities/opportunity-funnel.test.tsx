/** @jest-environment jsdom */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'

import { OpportunityFunnel } from '@/app/opportunities/opportunity-funnel'
import type { OutcomeFunnelSummary } from '@/lib/opportunities/outcome-repository'

function summaryWithActivity(
  effectiveActivityCounts: OutcomeFunnelSummary['effectiveActivityCounts'],
): OutcomeFunnelSummary {
  return {
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
    effectiveActivityCounts,
    ledgerActivityCounts: [],
    correctionsCount: 0,
    cohortCounts: [
      { eventType: 'shown', label: 'Показано', count: 4 },
      { eventType: 'opened', label: 'Открыто', count: 3 },
      { eventType: 'accepted', label: 'Взято в работу', count: 1 },
    ],
    conversions: [{
      from: 'shown',
      to: 'accepted',
      sampleSize: 4,
      converted: 1,
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
  }
}

describe('OpportunityFunnel', () => {
  it('does not spend attention on observational-only empty analytics', () => {
    const { container } = render(<OpportunityFunnel summary={summaryWithActivity([
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
    ])} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText(
      'Воронка конверсий появится после первого коммерческого действия по ситуации.',
    )).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Коммерческие результаты' })).toBeNull()
  })

  it('shows absolute counts without invented percentages once commercial work starts', () => {
    render(<OpportunityFunnel summary={summaryWithActivity([
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
      {
        eventType: 'accepted',
        label: 'Взято в работу',
        eventCount: 1,
        opportunityCount: 1,
      },
    ])} />)

    expect(screen.getByRole('heading', { name: 'Коммерческие результаты' }))
      .toBeInTheDocument()
    expect(screen.getByText('Показано')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getAllByText('Недостаточно данных')).toHaveLength(2)
    expect(screen.getAllByText('Незрелая когорта', { exact: false }))
      .toHaveLength(2)
    expect(screen.getByText(
      'Показано 7 раз · 4 ситуации',
      { exact: false },
    )).toBeInTheDocument()
    expect(screen.queryByText('25%')).toBeNull()
  })

  it('keeps conversion analytics after the situation ledger in page composition', () => {
    const page = readFileSync(
      resolve(process.cwd(), 'app/opportunities/page.tsx'),
      'utf8',
    )

    expect(page.indexOf('<SituationRow')).toBeGreaterThan(-1)
    expect(page.indexOf('{funnel ? <OpportunityFunnel summary={funnel} /> : null}'))
      .toBeGreaterThan(page.indexOf('<SituationRow'))
  })
})
