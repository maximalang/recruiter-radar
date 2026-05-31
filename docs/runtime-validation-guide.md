# Runtime Validation Guide for Recruiter Radar

This document explains the runtime validation patterns used in Recruiter Radar for ensuring data integrity and preventing runtime errors.

## Overview

The application implements runtime validation using schema-based validation that works without external dependencies like Zod. This approach provides:

- Type safety at runtime
- Input validation for user data
- State mutation validation
- API response validation
- Form validation with error handling

## Core Validation Principles

### 1. Schema-Driven Validation

All data structures are validated using schema validators:

```typescript
import { dashboardOverviewSchema, combinedStateValidator } from '../lib/validation-schemas';

// Validate dashboard overview
if (dashboardOverviewSchema.validate(data)) {
  // Data is valid
} else {
  // Handle invalid data
}
```

### 2. Action Validation

All state mutations are validated before and after updates:

```typescript
// In reducers
if (!dashboardStateSchema.validate({ ...state, overview })) {
  console.error('Invalid dashboard state');
  return state; // Reject invalid state
}
```

### 3. Form Validation

Complex forms use dedicated validation hooks:

```typescript
const { formData, errors, isValid, handleSubmit } = useAsyncFormSubmit<FormData>(
  onSubmit,
  initialData,
  validationRules
);
```

## Validation Schemas

### Dashboard State Validation

Validates dashboard overview, sources, alerts, and loading states:

```typescript
const dashboardStateSchema = {
  validate: (data: unknown): data is DashboardState => {
    return isObject(data) &&
      dashboardOverviewSchema.validate(data.overview) &&
      isArray(data.sources) &&
      isArray(data.alerts) &&
      isObject(data.loading);
  }
};
```

### State Management Validation

Ensures state mutations maintain data integrity:

```typescript
function rootReducer(state: CombinedState, action: BaseAction): CombinedState {
  const newState = {
    dashboard: dashboardReducer(state.dashboard, action),
    ui: uiReducer(state.ui, action)
  };

  // Validate combined state after mutation
  const validationResult = combinedStateValidator.safeParse(newState);
  if (!validationResult.success) {
    console.error('State validation failed');
    return state; // Revert to previous state
  }

  return newState;
}
```

## Form Validation

### useAsyncFormSubmit Hook

Combines form state management with async submission and validation:

```typescript
interface FormData {
  email: string;
  password: string;
  confirmPassword: string;
}

const { 
  formData, 
  setFormData, 
  handleChange,
  isSubmitting, 
  submitError, 
  errors, 
  isValid, 
  handleSubmit 
} = useAsyncFormSubmit<FormData>(
  async (data) => {
    await submitForm(data);
  },
  initialFormData,
  {
    email: validationRules.email,
    password: validationRules.password,
    confirmPassword: validationRules.confirmPassword(formData.password)
  }
);
```

### Validation Rules

Pre-defined validation rules for common patterns:

```typescript
export const validationRules = {
  email: {
    required: true,
    validator: (value: string) => formValidation.email(value),
    message: 'Please enter a valid email address'
  },
  phone: {
    required: false,
    validator: (value: string) => formValidation.phone(value),
    message: 'Please enter a valid phone number'
  },
  url: {
    required: false,
    validator: (value: string) => formValidation.url(value),
    message: 'Please enter a valid URL'
  },
  password: {
    required: true,
    validator: (value: string) => value.length >= 8,
    message: 'Password must be at least 8 characters long'
  }
};
```

## API Validation

### Response Validation

Validate API responses before updating state:

```typescript
export function validateApiResponse<T>(response: unknown, schema: { validate: (data: unknown) => data is T }): T {
  if (!schema.validate(response)) {
    throw new Error('Invalid API response format');
  }
  return response;
}

// Usage
const userData = validateApiResponse(apiResponse, userProfileSchema);
```

### Async Action Validation

Ensure async operations return valid data:

```typescript
export function createValidatedAsyncAction<T>(
  type: string,
  asyncFn: () => Promise<T>,
  validationFn?: (data: T) => boolean
) {
  return async (dispatch: any, getState: any) => {
    try {
      const result = await asyncFn();
      
      if (validationFn && !validationFn(result)) {
        throw new Error('Async action result validation failed');
      }
      
      dispatch({ type: `${type}_FULFILLED`, payload: result });
    } catch (error) {
      dispatch({ type: `${type}_REJECTED`, payload: { error } });
    }
  };
}
```

## Error Handling

### Validation Errors

Handle validation errors gracefully:

```typescript
export const createValidationError = (field: string, message: string) => ({
  field,
  message,
  timestamp: new Date().toISOString()
});

export const isValidationError = (error: unknown): error is { field: string; message: string } => {
  return isObject(error) && isString(error.field) && isString(error.message);
};
```

### Error Boundaries

Implement error boundaries for UI components:

```typescript
class ValidationErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Validation error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return <div>Something went wrong with validation.</div>;
    }
    return this.props.children;
  }
}
```

## Performance Considerations

### Validation Optimization

- **Debounce validation** for user input
- **Memoize validation results** to prevent re-computation
- **Lazy validation** - only validate when necessary
- **Batch validation** for multiple fields at once

```typescript
// Debounce field validation
const debouncedValidateField = useDebounce(
  (name: string, value: any) => {
    validateField(name, value);
  },
  300
);
```

### Conditional Validation

Skip validation in production or for performance-critical paths:

```typescript
if (process.env.NODE_ENV === 'development') {
  // Run additional validation in development
  if (!schema.validate(data)) {
    console.warn('Validation failed in development:', data);
  }
}
```

## Testing Validation

### Unit Tests

Test validation schemas:

```typescript
describe('dashboardOverviewSchema', () => {
  it('should validate valid dashboard overview', () => {
    const validData = {
      totalSources: 10,
      activeSources: 8,
      overallHealth: 85,
      totalAlerts: 2,
      lastUpdated: new Date().toISOString()
    };
    
    expect(dashboardOverviewSchema.validate(validData)).toBe(true);
  });

  it('should reject invalid data', () => {
    const invalidData = {
      totalSources: 'invalid',
      activeSources: 8,
      overallHealth: 85,
      totalAlerts: 2
    };
    
    expect(dashboardOverviewSchema.validate(invalidData)).toBe(false);
  });
});
```

### Integration Tests

Test form validation end-to-end:

```typescript
test('form validation rejects invalid email', async () => {
  render(<FormComponent />);
  fireEvent.change(screen.getByLabelText('Email'), { 
    target: { value: 'invalid-email' } 
  });
  
  expect(screen.getByText('Please enter a valid email address')).toBeInTheDocument();
  
  fireEvent.click(screen.getByText('Submit'));
  
  await waitFor(() => {
    expect(screen.getByText('Form submitted')).not.toBeInTheDocument();
  });
});
```

## Migration to Zod

When ready to migrate to Zod:

1. Replace schema implementations:

```typescript
// From custom schema
import { z } from 'zod';

// To Zod schema
const dashboardOverviewSchema = z.object({
  totalSources: z.number(),
  activeSources: z.number(),
  overallHealth: z.number(),
  totalAlerts: z.number(),
  lastUpdated: z.string().datetime()
});

// Usage
const result = dashboardOverviewSchema.safeParse(data);
```

2. Update validation functions:

```typescript
// Before
if (schema.validate(data)) { ... }

// After
if (schema.parse(data)) { ... }
```

## Best Practices

1. **Always validate external data** - API responses, user input, local storage
2. **Provide clear error messages** - Help users understand what's wrong
3. **Use progressive validation** - Validate on blur, submit, or real-time as appropriate
4. **Log validation errors** - For debugging and monitoring
5. **Fallback gracefully** - Provide default values when validation fails
6. **Consider security implications** - Don't expose validation errors that could reveal system information

## Troubleshooting

### Common Issues

1. **Performance issues**: Use memoization and debounce validation
2. **State corruption**: Revert to previous state on validation failure
3. **False positives**: Check validation rules for overly strict constraints
4. **Integration errors**: Ensure validation happens at the right time in the lifecycle

### Debugging

Enable debug logging:

```typescript
const DEBUG_VALIDATION = process.env.NODE_ENV === 'development';

if (DEBUG_VALIDATION) {
  console.log('Validating data:', data);
  console.log('Validation result:', schema.validate(data));
}
```