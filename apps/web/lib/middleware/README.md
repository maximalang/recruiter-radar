# Unified Middleware System

## Overview

The unified middleware system provides a centralized and enhanced approach to handling middleware in Recruiter Radar. It combines all middleware functionality into a single, configurable system with improved error handling, logging, and composition capabilities.

## Features

- **Enhanced Error Handling**: Automatic error capture and custom error callbacks
- **Performance Tracking**: Built-in middleware execution timing
- **Rate Limiting**: Configurable action rate limiting
- **Conditional Middleware**: Run middleware based on action conditions
- **Unified Validation**: Integrated validation with error reporting
- **Case Conversion**: Seamless snake_case ↔ camelCase conversion
- **Logging**: Comprehensive middleware activity logging
- **Async Action Handling**: Proper async action lifecycle management

## Quick Start

### Basic Usage

```typescript
import { createUnifiedMiddleware } from './unified-middleware';

// Create middleware with default configuration
const middleware = createUnifiedMiddleware();
```

### Custom Configuration

```typescript
const customMiddleware = createUnifiedMiddleware({
  enableErrorHandling: true,
  enableLogging: false,
  enableCaseConversion: true,
  enableValidation: true,
  enableRateLimiting: true,
  maxActions: 5,
  timeWindow: 2000
});
```

### Pre-configured Stacks

```typescript
import { middlewareStacks } from './unified-middleware';

// Development with verbose logging
const devMiddleware = middlewareStacks.development;

// Production with strict controls
const prodMiddleware = middlewareStacks.production;

// Minimal for performance
const minimalMiddleware = middlewareStacks.minimal;
```

## Middleware Components

### Case Conversion Middleware
- **apiResponseConversionMiddleware**: Converts API snake_case responses to camelCase
- **apiRequestConversionMiddleware**: Converts camelCase actions to snake_case for APIs
- **formInputConversionMiddleware**: Handles form input conversion
- **queryParamConversionMiddleware**: Converts query parameters

### Validation Middleware
- **enhancedValidationMiddleware**: Action validation with error handling
- **createValidator**: Creates custom validation rules
- **ValidationResult**: Type-safe validation results

### Error Handling
- **createErrorMiddleware**: Automatic error capture and dispatch
- **custom onError handlers**: Define your own error handling logic

### Rate Limiting
- **createRateLimitMiddleware**: Configurable rate limiting per action type
- **maxActions**: Maximum actions per time window
- **timeWindow**: Time window in milliseconds

### Logging
- **createLoggingMiddleware**: Middleware activity logging
- **Performance tracking**: Execution timing for each action

### Conditional Middleware
- **createConditionalMiddleware**: Run middleware based on conditions
- **Custom conditions**: Define your own action conditions

## Configuration Options

```typescript
interface MiddlewareStackConfig {
  // Error handling
  enableErrorHandling?: boolean;
  
  // Logging
  enableLogging?: boolean;
  enablePerformanceTracking?: boolean;
  
  // Validation
  enableValidation?: boolean;
  enableValidationErrors?: boolean;
  
  // Case conversion
  enableCaseConversion?: boolean;
  
  // Rate limiting
  enableRateLimiting?: boolean;
  maxActions?: number;
  timeWindow?: number;
  
  // Custom error handler
  onError?: (error: Error, action: BaseAction) => void;
}
```

## Integration

### With Redux

```typescript
import { createStore, applyMiddleware } from 'redux';
import { createUnifiedMiddleware } from './unified-middleware';

const store = createStore(
  rootReducer,
  initialState,
  applyMiddleware(...createUnifiedMiddleware())
);
```

### With React Context

```typescript
const AppProvider = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, initialState);
  
  // Create enhanced dispatch with middleware
  const enhancedDispatch = createUnifiedMiddleware()(dispatch);
  
  return (
    <AppContext.Provider value={{ state, dispatch: enhancedDispatch }}>
      {children}
    </AppContext.Provider>
  );
};
```

## Action Types

The system defines these action types for middleware communication:

- `VALIDATION_ERROR`: Validation failures
- `RATE_LIMIT_EXCEEDED`: Rate limit violations
- `MIDDLEWARE_ERROR`: General middleware errors
- `ASYNC_ACTION_STARTED`: Async action started
- `ASYNC_ACTION_FULFILLED`: Async action completed
- `ASYNC_ACTION_REJECTED`: Async action failed

## Migration Guide

### From Individual Middleware

```typescript
// Before
import { apiResponseConversionMiddleware } from './case-conversion-middleware';
import { validationMiddleware } from './validation-middleware';

// After
import { createUnifiedMiddleware } from './unified-middleware';
const middleware = createUnifiedMiddleware();
```

### From Old Middleware System

```typescript
// Before
const middleware = applyMiddleware(
  apiResponseConversionMiddleware,
  validationMiddleware,
  errorHandlingMiddleware
);

// After
const middleware = middlewareStacks.full;
```

## Performance Considerations

- **Production**: Use `middlewareStacks.production` for minimal overhead
- **Development**: Use `middlewareStacks.development` for detailed logging
- **Critical paths**: Consider `middlewareStacks.minimal` for performance-critical routes
- **Rate limiting**: Adjust maxActions/timeWindow based on your needs

## Testing

Middleware can be tested independently or as part of the stack:

```typescript
import { createUnifiedMiddleware } from './unified-middleware';

describe('Unified Middleware', () => {
  it('should handle case conversion', () => {
    const middleware = createUnifiedMiddleware();
    // Test implementation
  });
  
  it('should validate actions', () => {
    // Test validation
  });
});
```

## Troubleshooting

### Common Issues

1. **Type errors**: Ensure all actions use `BaseAction` type
2. **Performance**: Disable unnecessary middleware in production
3. **Debugging**: Enable logging to track middleware flow
4. **Errors**: Check error handlers for proper error handling

### Debug Tools

- Enable `enableLogging: true` for detailed logs
- Use `enablePerformanceTracking: true` to identify bottlenecks
- Check error handlers to ensure proper error capture

## Future Enhancements

- [ ] Cache middleware results
- [ ] Add middleware composition utilities
- [ ] Implement middleware dependency management
- [ ] Add monitoring and metrics
- [ ] Support for async middleware chains