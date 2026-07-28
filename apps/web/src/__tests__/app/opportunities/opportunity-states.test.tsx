/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react'

import OpportunitiesError from '@/app/opportunities/error'
import OpportunitiesLoading from '@/app/opportunities/loading'

describe('opportunities page states', () => {
  it('renders a named loading state', () => {
    render(<OpportunitiesLoading />)
    expect(screen.getByRole('heading', { name: 'Morning Brief' })).toBeInTheDocument()
    expect(screen.getByText('Собираем свежие эпизоды и доказательства.')).toBeInTheDocument()
  })

  it('renders a recoverable error boundary', () => {
    render(<OpportunitiesError reset={jest.fn()} />)
    expect(screen.getByText('Brief временно не загрузился')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Попробовать снова' })).toBeInTheDocument()
  })
})
