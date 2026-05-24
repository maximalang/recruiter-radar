import React from 'react'
import { render } from '@testing-library/react'
import type { RenderOptions } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AppContextType } from '@/lib/state-management-types'

// Create a client for React Query testing
const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

const AllTheProviders: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = createTestQueryClient()

  // Mock App Context
  const mockAppContext: AppContextType = {
    dashboard: {
      overview: {
        totalSources: 0,
        activeSources: 0,
        overallHealth: 0,
        totalAlerts: 0,
        lastUpdated: new Date().toISOString(),
      },
      sources: [],
      alerts: [],
      loading: { isLoading: false },
    },
    digest: {
      currentRun: {
        status: 'idle',
        progress: 0,
      },
      history: [],
      settings: {
        autoRefresh: false,
        refreshInterval: 60000,
        maxItems: 50,
        filters: {
          confidenceGates: ['A', 'B', 'C', 'D'],
          sources: [],
        },
      },
      loading: { isLoading: false },
    },
    clientProfile: {
      currentProfile: null,
      profiles: [],
      isEditing: false,
      loading: { isLoading: false },
    },
    ui: {
      theme: 'light',
      language: 'ru',
      sidebar: {
        isOpen: true,
        width: 240,
      },
      notifications: [],
      modals: {},
    },
    actions: {
      refreshDashboard: jest.fn(),
      updateSourceStatus: jest.fn(),
      runDigest: jest.fn(),
      cancelDigest: jest.fn(),
      switchProfile: jest.fn(),
      updateProfile: jest.fn(),
      toggleTheme: jest.fn(),
      showNotification: jest.fn(),
      dismissNotification: jest.fn(),
      openModal: jest.fn(),
      closeModal: jest.fn(),
    },
  }

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}

const customRender = (
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) => render(ui, { wrapper: AllTheProviders, ...options })

export * from '@testing-library/react'
export { customRender as render, createTestQueryClient }