// Unified middleware system - Centralized middleware composition
import {
  EnhancedMiddleware,
  MiddlewareConfig,
  createMiddlewarePipeline,
  defaultMiddlewareStack,
  createConditionalMiddleware,
  createRateLimitMiddleware,
  createErrorMiddleware,
  createLoggingMiddleware,
  createValidationMiddleware as createSystemValidationMiddleware
} from './middleware/system';
import { BaseAction } from './state-management-types';

// Case conversion middleware
import {
  apiResponseConversionMiddleware,
  apiRequestConversionMiddleware,
  formInputConversionMiddleware,
  queryParamConversionMiddleware
} from './case-conversion-middleware';

// Validation middleware
import { enhancedValidationMiddleware } from './validation-middleware';

// Middleware stack configuration
export interface MiddlewareStackConfig extends MiddlewareConfig {
  enableCaseConversion?: boolean;
  enableValidation?: boolean;
  enableRateLimiting?: boolean;
  maxActions?: number;
  timeWindow?: number;
}

// Default configuration
const defaultConfig: MiddlewareStackConfig = {
  enableErrorHandling: true,
  enableLogging: true,
  enablePerformanceTracking: false,
  enableCaseConversion: true,
  enableValidation: true,
  enableRateLimiting: true,
  maxActions: 10,
  timeWindow: 1000 // 1 second
};

// Create case conversion middleware
export function createCaseConversionMiddlewareStack(): EnhancedMiddleware[] {
  return [
    apiResponseConversionMiddleware,
    apiRequestConversionMiddleware,
    formInputConversionMiddleware,
    queryParamConversionMiddleware
  ];
}

// Create validation middleware stack
export function createValidationMiddlewareStack(): EnhancedMiddleware[] {
  return [
    enhancedValidationMiddleware
  ];
}

// Create complete middleware stack
export function createUnifiedMiddlewareStack(
  config: MiddlewareStackConfig = defaultConfig
): EnhancedMiddleware[] {
  const middlewares: EnhancedMiddleware[] = [];

  // Add case conversion middleware if enabled
  if (config.enableCaseConversion) {
    middlewares.push(...createCaseConversionMiddlewareStack());
  }

  // Add validation middleware if enabled
  if (config.enableValidation) {
    middlewares.push(...createValidationMiddlewareStack());
  }

  // Add rate limiting if enabled
  if (config.enableRateLimiting) {
    middlewares.push(
      createRateLimitMiddleware(
        config.maxActions || 10,
        config.timeWindow || 1000
      )
    );
  }

  // Add default middleware stack (error handling, logging, etc.)
  middlewares.push(...defaultMiddlewareStack(config));

  return middlewares;
}

// Create composed middleware function
export function createUnifiedMiddleware(config: MiddlewareStackConfig = defaultConfig) {
  const middlewares = createUnifiedMiddlewareStack(config);
  return createMiddlewarePipeline(middlewares, config);
}

// Pre-configured middleware stacks
export const middlewareStacks = {
  // Full stack with all features
  full: createUnifiedMiddlewareStack(defaultConfig),

  // Development stack with verbose logging
  development: createUnifiedMiddlewareStack({
    ...defaultConfig,
    enableLogging: true,
    enablePerformanceTracking: true,
    enableCaseConversion: true,
    enableValidation: true,
    enableRateLimiting: false
  }),

  // Production stack with strict error handling
  production: createUnifiedMiddlewareStack({
    ...defaultConfig,
    enableLogging: false,
    enablePerformanceTracking: false,
    enableCaseConversion: true,
    enableValidation: true,
    enableRateLimiting: true
  }),

  // Minimal stack for high-performance scenarios
  minimal: createUnifiedMiddlewareStack({
    ...defaultConfig,
    enableCaseConversion: false,
    enableValidation: false,
    enableRateLimiting: false,
    enableLogging: false,
    enablePerformanceTracking: false
  })
};

// Conditional middleware factory
export function createConditionalCaseConversionMiddleware(condition: (action: BaseAction) => boolean) {
  const middleware = createCaseConversionMiddlewareStack();
  return createConditionalMiddleware(condition, middleware[0]);
}

// Usage examples:
/*
// Basic usage with default configuration
const middleware = createUnifiedMiddleware();

// Custom configuration
const customMiddleware = createUnifiedMiddleware({
  enableErrorHandling: true,
  enableLogging: false,
  enableCaseConversion: true,
  enableValidation: false,
  enableRateLimiting: true,
  maxActions: 5,
  timeWindow: 2000
});

// Using pre-configured stack
const productionMiddleware = createUnifiedMiddlewareStack(middlewareStacks.production);

// Applying middleware to Redux store
const store = createStore(
  rootReducer,
  initialState,
  applyMiddleware(
    ...middlewareStacks.full
  )
);
*/