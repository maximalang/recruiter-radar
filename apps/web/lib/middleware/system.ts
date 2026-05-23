// Enhanced middleware system with improved error handling and composition
import type { Middleware, MiddlewareAPI, Dispatch, BaseAction } from '../state-management-types';

// Middleware type with enhanced context
export interface EnhancedMiddleware<S = unknown> {
  (store: MiddlewareAPI<S>, next: Dispatch<S>): Dispatch<S>;
}

// Middleware configuration options
export interface MiddlewareConfig {
  enableErrorHandling?: boolean;
  enableLogging?: boolean;
  enablePerformanceTracking?: boolean;
  onError?: (error: Error, action: BaseAction) => void;
}

// Error handling middleware
export function createErrorMiddleware<S>(
  config: MiddlewareConfig = {}
): EnhancedMiddleware<S> {
  return (store, next) => (action) => {
    try {
      return next(action);
    } catch (error) {
      if (config.onError) {
        config.onError(error as Error, action);
      } else {
        console.error('Middleware error:', error);
      }

      // Error action
      if (config.enableErrorHandling) {
        return store.dispatch({
          type: 'MIDDLEWARE_ERROR',
          payload: {
            error: error instanceof Error ? error.message : 'Unknown error',
            actionType: action.type,
            timestamp: new Date().toISOString()
          }
        });
      }

      throw error;
    }
  };
}

// Logging middleware
export function createLoggingMiddleware<S>(
  config: MiddlewareConfig = {}
): EnhancedMiddleware<S> {
  return (store, next) => (action) => {
    const startTime = config.enablePerformanceTracking ? performance.now() : null;

    console.log('Dispatching:', action.type, action.payload);

    try {
      const result = next(action);

      if (startTime) {
        const duration = performance.now() - startTime;
        console.log(`Action ${action.type} completed in ${duration.toFixed(2)}ms`);
      }

      return result;
    } catch (error) {
      console.error(`Action ${action.type} failed:`, error);
      throw error;
    }
  };
}

// Action validation middleware
export function createValidationMiddleware<S>(
  validator: (action: BaseAction) => boolean
): EnhancedMiddleware<S> {
  return (store, next) => (action) => {
    if (!validator(action)) {
      console.warn('Invalid action structure:', action);
      return store.dispatch({
        type: 'VALIDATION_ERROR',
        payload: {
          message: 'Invalid action structure',
          actionType: action.type
        }
      });
    }

    return next(action);
  };
}

// Rate limiting middleware
export function createRateLimitMiddleware<S>(
  maxActions: number,
  timeWindow: number
): EnhancedMiddleware<S> {
  const actionCounts = new Map<string, number[]>();

  return (store, next) => (action) => {
    const now = Date.now();
    const actionType = action.type;

    // Clean old entries
    if (actionCounts.has(actionType)) {
      const timestamps = actionCounts.get(actionType)!;
      const recent = timestamps.filter(t => now - t < timeWindow);

      if (recent.length >= maxActions) {
        console.warn(`Rate limit exceeded for action: ${actionType}`);
        return store.dispatch({
          type: 'RATE_LIMIT_EXCEEDED',
          payload: {
            actionType,
            maxActions,
            timeWindow
          }
        });
      }

      actionCounts.set(actionType, recent);
    } else {
      actionCounts.set(actionType, [now]);
    }

    return next(action);
  };
}

// Conditional middleware
export function createConditionalMiddleware<S>(
  condition: (action: BaseAction) => boolean,
  middleware: EnhancedMiddleware<S>
): EnhancedMiddleware<S> {
  return (store, next) => (action) => {
    if (condition(action)) {
      return middleware(store, next)(action);
    }
    return next(action);
  };
}

// Async action middleware
export function createAsyncMiddleware<S>(): EnhancedMiddleware<S> {
  return (store, next) => (action) => {
    if (action.type.endsWith('_PENDING')) {
      console.log('Async action started:', action.type);
      store.dispatch({
        type: `${action.type.replace('_PENDING', '_STARTED')}`,
        payload: action.payload
      });
    }

    const result = next(action);

    if (action.type.endsWith('_FULFILLED')) {
      console.log('Async action completed:', action.type);
    } else if (action.type.endsWith('_REJECTED')) {
      console.error('Async action failed:', action.type, action.payload);
    }

    return result;
  };
}

// Create middleware pipeline
export function createMiddlewarePipeline<S>(
  middlewares: EnhancedMiddleware<S>[],
  config: MiddlewareConfig = {}
): Dispatch<S> {
  return (action: BaseAction) => {
    const store = {
      getState: () => ({} as S),
      dispatch: (action: BaseAction) => action
    };

    let dispatch: Dispatch<S> = (action) => action;

    // Add error handling at the end
    if (config.enableErrorHandling) {
      middlewares.push(createErrorMiddleware(config) as EnhancedMiddleware<S>);
    }

    // Add logging at the beginning
    if (config.enableLogging) {
      middlewares.unshift(createLoggingMiddleware(config) as EnhancedMiddleware<S>);
    }

    // Compose middlewares
    for (const middleware of [...middlewares].reverse()) {
      dispatch = middleware(store, dispatch);
    }

    return dispatch(action);
  };
}

// Pre-configured middleware stack
export const defaultMiddlewareStack = <S>(
  config: MiddlewareConfig = {}
): EnhancedMiddleware<S>[] => [
  createErrorMiddleware(config),
  createLoggingMiddleware(config),
  createAsyncMiddleware<S>()
];

// Example usage:
/*
const store = applyMiddleware(reducer, initialState,
  ...defaultMiddlewareStack(),
  createValidationMiddleware(action => validateAction(action)),
  createRateLimitMiddleware(10, 1000) // 10 actions per second
);
*/