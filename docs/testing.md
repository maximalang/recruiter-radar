# Testing Guide for Recruiter Radar

## Overview

This project uses Jest and React Testing Library for testing. The testing infrastructure is set up to provide comprehensive test coverage for React components, middleware, and utilities.

## Test Structure

```
src/
├── __tests__/
│   ├── components/       # Component tests
│   ├── utils/           # Utility function tests
│   └── middleware/      # Middleware tests
```

## Running Tests

### Basic Test Execution
```bash
npm test
```

### Watch Mode
```bash
npm run test:watch
```

### Coverage Report
```bash
npm run test:coverage
```

## Test Conventions

### Component Tests
- Use descriptive test names that explain what's being tested
- Follow Arrange-Act-Assert pattern
- Test both happy paths and error cases
- Mock external dependencies

### Middleware Tests
- Test middleware behavior with valid and invalid inputs
- Verify dispatch calls for error cases
- Mock store state appropriately

### Utility Tests
- Test all possible input variations
- Include edge cases
- Validate error handling

## Mocking

### Common Mocks
- Next.js router
- Window.matchMedia
- ResizeObserver
- IntersectionObserver
- localStorage
- fetch

### Custom Mocks
Create mocks in `jest.setup.ts` or use `jest.mock()` in individual test files.

## Best Practices

1. **Test Behavior, Not Implementation**
   - Focus on what the component does, not how it does it
   - Avoid implementation-specific tests

2. **Use Semantic Test Names**
   ```typescript
   // Good
   it('displays error message when password is too short')
   
   // Bad
   it('renders component correctly')
   ```

3. **Group Related Tests**
   Use `describe` blocks to group related tests:
   ```typescript
   describe('DashboardOverview', () => {
     describe('when health is excellent', () => {
       // tests
     })
   })
   ```

4. **Test Async Operations**
   Use async/await for async operations:
   ```typescript
   it('fetches data on mount', async () => {
     // ... arrange
     await act(async () => {
       render(<Component />)
     })
     // ... assert
   })
   ```

## Test Environment

### TypeScript Support
Tests are written in TypeScript and configured with:
- Strict type checking
- Autocomplete support
- Type inference for mock functions

### React Query
Tests use a mock QueryClient to prevent actual data fetching.

## Coverage Requirements

- Minimum 80% coverage for:
  - Branches
  - Functions
  - Lines
  - Statements

Coverage reports are generated in the `coverage/` directory.

## Adding New Tests

1. Identify components/units that need testing
2. Write failing tests first (Red)
3. Implement code to pass tests (Green)
4. Refactor if needed (Refactor)
5. Ensure all tests pass

## Continuous Integration

Tests are configured to run in CI environments with:
- Headless browser mode
- Coverage reporting
- Fast failure on errors