# State Management Guide for Recruiter Radar

## Overview

This document explains the state management patterns used in Recruiter Radar. The application uses React Context API with a middleware pattern for managing global state.

## Architecture

### 1. State Structure

The global state is organized into four main areas:

```typescript
interface CombinedState {
  dashboard: DashboardState;      // Dashboard-related state
  digest: DigestState;           // Digest and feed state
  clientProfile: ClientProfileState; // User and profile state
  ui: UIState;                   // UI and theme state
}
```

### 2. Context Provider

The `AppProvider` wraps the entire application and provides the global context:

```tsx
import { AppProvider } from '../lib/app-context';

function MyApp({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider initialState={customInitialState}>
      {children}
    </AppProvider>
  );
}
```

## Usage Patterns

### 1. Accessing State

```tsx
import { useAppContext } from '../lib/app-context';

function MyComponent() {
  const { dashboard, ui, actions } = useAppContext();

  return (
    <div>
      <h1>Dashboard Health: {dashboard.overview.overallHealth}%</h1>
      <button onClick={actions.toggleTheme}>
        Toggle {ui.theme} theme
      </button>
    </div>
  );
}
```

### 2. Updating State

```tsx
function MyComponent() {
  const { actions } = useAppContext();

  const handleRefresh = async () => {
    await actions.refreshDashboard();
  };

  return <button onClick={handleRefresh}>Refresh</button>;
}
```

### 3. Selectors

Use selectors to derive computed values efficiently:

```tsx
// In lib/selectors.ts
export const selectDashboardOverview = (state: CombinedState) => state.dashboard.overview;
export const selectActiveSources = (state: CombinedState) => 
  state.dashboard.sources.filter(source => source.overall > 70);

// In component
const { selectDashboardOverview } = useAppContext();
const overview = selectDashboardOverview(store.getState());
```

## Custom Hooks

The project includes several custom hooks for common patterns:

### 1. `useAsync`

For handling async operations:

```tsx
function MyComponent() {
  const { data, loading, error, execute } = useAsync(
    async () => {
      const response = await fetch('/api/data');
      return response.json();
    },
    { immediate: false } // Don't run on mount
  );

  return (
    <div>
      {loading && <span>Loading...</span>}
      {error && <span className="error">{error}</span>}
      {data && <pre>{JSON.stringify(data, null, 2)}</pre>}
    </div>
  );
}
```

### 2. `useLocalStorage`

For persisting data to localStorage:

```tsx
function ThemeSwitcher() {
  const [theme, setTheme] = useLocalStorage<'light' | 'dark'>('theme', 'light');

  return (
    <button onClick={() => setTheme(prev => prev === 'light' ? 'dark' : 'light')}>
      Current theme: {theme}
    </button>
  );
}
```

### 3. `useDebounce`

For debouncing input values:

```tsx
function SearchInput() {
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebounce(searchTerm, 300);

  useEffect(() => {
    if (debouncedSearch) {
      fetchResults(debouncedSearch);
    }
  }, [debouncedSearch]);

  return (
    <input
      type="text"
      value={searchTerm}
      onChange={(e) => setSearchTerm(e.target.value)}
      placeholder="Search..."
    />
  );
}
```

## Middleware

The middleware pattern allows handling complex side effects:

### 1. Logger Middleware

```tsx
// Logs all state changes
const loggerMiddleware: Middleware = (store) => (next) => (action) => {
  console.group(`Action: ${action.type}`);
  console.log('Previous state:', store.getState());
  console.log('Action:', action);
  
  const result = next(action);
  
  console.log('Next state:', store.getState());
  console.groupEnd();
  
  return result;
};
```

### 2. Async Middleware

For handling async operations with lifecycle:

```tsx
// Automatically handles async actions
const asyncAction = createAsyncAction('FETCH_DATA', fetchData());

store.dispatch(asyncAction);
// This will dispatch:
// { type: 'FETCH_DATA_PENDING' }
// { type: 'FETCH_DATA_FULFILLED', payload: { data: result } }
// { type: 'FETCH_DATA_REJECTED', payload: { error } }
```

## Best Practices

### 1. State Updates

- Keep state updates atomic
- Avoid direct state mutations
- Use action creators for consistency
- Prefer functional updates when needed

### 2. Performance

- Use memoization for expensive computations
- Implement selectors for derived state
- Avoid unnecessary re-renders with proper component splitting
- Use useCallback and useMemo appropriately

### 3. Error Handling

- Wrap async operations in try/catch
- Provide user feedback for errors
- Implement retry logic for failed operations
- Log errors for debugging

### 4. Testing

- Test reducers with various actions
- Mock the context for component tests
- Test custom hooks independently
- Verify middleware behavior

## Migration Guide

### From useState to Context

1. Identify shared state that needs to be global
2. Create context and provider
3. Replace local state with context access
4. Implement action creators for updates

### From Redux to Context

1. Move action creators to context
2. Convert selectors to computed values
3. Replace middleware with context effects
4. Gradually migrate components

## Future Enhancements

1. **Zustand Integration**: Consider Zustand for simpler state management
2. **Redux Toolkit**: For complex applications requiring Redux features
3. **GraphQL Integration**: For server state synchronization
4. **Offline Support**: Using IndexedDB for offline data persistence