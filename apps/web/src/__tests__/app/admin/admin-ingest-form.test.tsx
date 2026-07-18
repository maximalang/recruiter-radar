/** @jest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import AdminIngestForm from '@/app/admin/admin-ingest-form'

jest.mock('@/app/admin/admin-actions', () => ({
  runIngest: jest.fn(),
}))

describe('AdminIngestForm', () => {
  it('gives the manual source selector an accessible name', () => {
    render(
      <AdminIngestForm
        sources={[
          { id: 'hh', name: 'HeadHunter', category: 'job-board', isPrimary: true, timeoutMs: 120_000 },
          { id: 'fedresurs', name: 'Fedresurs', category: 'registry', isPrimary: false, timeoutMs: 120_000 },
        ]}
      />,
    )

    fireEvent.click(screen.getByLabelText('Один источник'))

    expect(screen.getByRole('combobox', { name: 'Источник для инжеста' })).toBeInTheDocument()
  })
})
