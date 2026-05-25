// Conditional jest-dom import — gracefully skip if package not installed
try {
  require.resolve('@testing-library/jest-dom')
  require('@testing-library/jest-dom')
} catch {
  // jest-dom not installed; skip matchers — unit tests will still run
}

// Polyfill TextEncoder/TextDecoder (needed by pg in node environment)
if (typeof globalThis.TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('util');
  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder;
}

// Mock Next.js router (jsdom only — skip in node environment)
if (typeof window !== 'undefined') {
  jest.mock('next/router', () => ({
    useRouter() {
      return {
        route: '/',
        pathname: '/',
        query: {},
        asPath: '/',
        push: jest.fn(),
        pop: jest.fn(),
        reload: jest.fn(),
        back: jest.fn(),
        prefetch: jest.fn().mockResolvedValue(undefined),
        beforePopState: jest.fn(),
        events: {
          on: jest.fn(),
          off: jest.fn(),
          emit: jest.fn(),
        },
        isFallback: false,
      }
    },
  }))

  // Mock window.matchMedia
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  })

  // Mock ResizeObserver
  global.ResizeObserver = jest.fn().mockImplementation(() => ({
    observe: jest.fn(),
    unobserve: jest.fn(),
    disconnect: jest.fn(),
  }))

  // Mock IntersectionObserver
  global.IntersectionObserver = jest.fn().mockImplementation(() => ({
    observe: jest.fn(),
    unobserve: jest.fn(),
    disconnect: jest.fn(),
  }))

  // Mock localStorage
  const localStorageMock = {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn(),
  }
  global.localStorage = localStorageMock as any
}

// Mock fetch (environment-agnostic)
global.fetch = jest.fn()

// Mock pg Pool for tests that import db modules
jest.mock('lib/db', () => ({
  getPool: jest.fn(() => null),
}))