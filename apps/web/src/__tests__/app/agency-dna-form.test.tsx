/** @jest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'

import { AgencyDnaForm } from '@/app/profile/agency-dna-form'
import type { AgencyDnaProfile } from '@/lib/agencyDnaProfile'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}))
jest.mock('@/app/profile/agency-dna-actions', () => ({
  saveAgencyDnaProfileAction: jest.fn(),
  saveAgencyAccountRestrictionAction: jest.fn(),
}))

const PROFILE: AgencyDnaProfile = {
  profileId: '11',
  ownerId: '7',
  workspaceId: '9',
  serviceTypes: [],
  targetSeniorities: [],
  minimumEngagementValueMinor: null,
  preferredEngagementTypes: [],
  caseStudies: [],
  currentCapacity: 'normal',
  agencyDnaVersion: 3,
  agencyDnaSnapshotHash: 'a'.repeat(64),
  updatedAt: '2026-08-01T10:00:00.000Z',
}

describe('AgencyDnaForm', () => {
  it('shows progressive completion, honest impact, and a meaningful restriction empty state', () => {
    render(
      <AgencyDnaForm
        profile={PROFILE}
        restrictions={[]}
        organizations={[]}
        matchCount={{ count: 12, capped: false }}
      />,
    )

    expect(screen.getByRole('heading', { name: /какое агентство/i })).toBeTruthy()
    expect(screen.getByRole('progressbar')).toHaveAttribute('max', '4')
    expect(screen.getByText(/профиль пока широкий/i)).toBeTruthy()
    expect(screen.getByText(/≈12 компаний/i)).toBeTruthy()
    expect(screen.getByText(/не меняя FIUR/i)).toBeTruthy()
    expect(screen.getByText(/после первой сборки opportunities/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Добавить' })).toBeDisabled()
  })

  it('updates the broad/narrow warning from keyboard-accessible native checkboxes', () => {
    render(
      <AgencyDnaForm
        profile={PROFILE}
        restrictions={[]}
        organizations={[]}
        matchCount={null}
      />,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: 'Постоянный подбор' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Senior' }))

    expect(screen.getByText(/профиль узкий/i)).toBeTruthy()
    expect(screen.getAllByText(/публично безопасное описание/i)).not.toHaveLength(0)
  })
})
