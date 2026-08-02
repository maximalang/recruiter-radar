/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react'

import OpportunitiesError from '@/app/opportunities/error'
import OpportunitiesLoading from '@/app/opportunities/loading'

describe('opportunities page states', () => {
  it('renders a named loading state', () => {
    render(<OpportunitiesLoading />)
    expect(screen.getByRole('heading', { name: 'Сегодня' })).toBeInTheDocument()
    expect(screen.getByText(
      'Собираем очереди действий и проверяем актуальность доказательств.',
    )).toBeInTheDocument()
  })

  it('renders a recoverable error boundary', () => {
    render(<OpportunitiesError reset={jest.fn()} />)
    expect(screen.getByRole('heading', { name: 'Сегодня' })).toBeInTheDocument()
    expect(screen.getByText('Возможности временно не загрузились')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Попробовать снова' })).toBeInTheDocument()
  })
})
