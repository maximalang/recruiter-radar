import type { Config } from 'jest'
import nextJest from 'next/jest.js'

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files
  dir: './',
})

// Add any custom config to be passed to Jest
const config: Config = {
  coverageProvider: 'v8',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.{js,jsx,ts,tsx}',
    '<rootDir>/src/**/*.{test,spec}.{js,jsx,ts,tsx}',
  ],
  testPathIgnorePatterns: [
    // requires @testing-library/react + @tanstack/react-query (not installed)
    '<rootDir>/src/__tests__/components/DashboardOverview.test.tsx',
    // requires jest-environment-jsdom + React hooks (validation-system.ts uses useState/useCallback)
    '<rootDir>/src/__tests__/middleware/validation-middleware.test.ts',
    // helper module, not a test file (no describe/it blocks)
    '<rootDir>/src/__tests__/lib/lead-discovery/hh-mock.ts',
  ],
  moduleNameMapper: {
    // test-utils moved to src/test-utils/ to avoid being picked as test file
    '^@/__tests__/utils/test-utils$': '<rootDir>/src/test-utils/render.tsx',
    '^@/__tests__/(.*)$': '<rootDir>/src/__tests__/$1',
    '^@/(.*)$': '<rootDir>/$1',
    '^lib/db$': '<rootDir>/lib/db.ts',
  },
  transform: {},
  collectCoverageFrom: [
    'src/**/*.{js,jsx,ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.stories.{js,jsx,ts,tsx}',
    '!src/**/*.test.{js,jsx,ts,tsx}',
    '!src/**/__tests__/**',
  ],
  testTimeout: 30000,
}

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
export default createJestConfig(config)