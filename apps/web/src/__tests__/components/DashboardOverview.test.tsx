import { render, screen, fireEvent } from '@/__tests__/utils/test-utils'
import { DashboardOverview } from '@/components/DashboardOverview'

describe('DashboardOverview', () => {
  const mockProps = {
    totalSources: 150,
    activeSources: 120,
    overallHealth: 85,
    totalAlerts: 5,
    lastUpdated: '2023-05-23T12:00:00Z',
  }

  it('renders dashboard overview with correct stats', () => {
    render(<DashboardOverview {...mockProps} />)

    expect(screen.getByText('150')).toBeInTheDocument()
    expect(screen.getByText('120')).toBeInTheDocument()
    expect(screen.getByText('85%')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('displays health status correctly', () => {
    const { rerender } = render(<DashboardOverview {...mockProps} />)

    // Test excellent health
    rerender(<DashboardOverview {...{ ...mockProps, overallHealth: 95 }} />)
    expect(screen.getByText(/отлично/i)).toBeInTheDocument()

    // Test good health
    rerender(<DashboardOverview {...{ ...mockProps, overallHealth: 75 }} />)
    expect(screen.getByText(/хорошо/i)).toBeInTheDocument()

    // Test warning health
    rerender(<DashboardOverview {...{ ...mockProps, overallHealth: 50 }} />)
    expect(screen.getByText(/требует внимания/i)).toBeInTheDocument()
  })

  it('shows last update time', () => {
    render(<DashboardOverview {...mockProps} />)
    expect(screen.getByText(/обновлено/i)).toBeInTheDocument()
  })
})