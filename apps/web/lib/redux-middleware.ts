// Redux-style Middleware for React Context State Management
// Provides middleware pattern for handling async actions and side effects

import type { BaseAction, Middleware, MiddlewareAPI } from './state-management-types';

// Logging middleware
export const loggerMiddleware: Middleware = (store: any) => (next: any) => (action: any) => {
  console.group(`Action: ${action.type}`);
  console.log('Previous state:', store.getState());
  console.log('Action:', action);

  const result = next(action);

  console.log('Next state:', store.getState());
  console.groupEnd();

  return result;
};

// Crash reporting middleware
export const crashReportingMiddleware: Middleware = (store: any) => (next: any) => (action: any) => {
  try {
    return next(action);
  } catch (error) {
    console.error('Caught an exception:', error);

    // In production, you would send this to an error tracking service
    if (process.env.NODE_ENV === 'production') {
      // trackError(error);
    }

    throw error;
  }
};

// Thunk middleware for async actions
export const thunkMiddleware: Middleware = (store: any) => (next: any) => (action: any) => {
  if (typeof action === 'function') {
    return action(store.dispatch, store.getState);
  }

  return next(action);
};

// Async middleware for handling async actions with lifecycle
export const asyncMiddleware: Middleware = (store: any) => (next: any) => (action: any) => {
  if (action.meta?.async) {
    const { requestId } = action.meta;

    // Dispatch pending action
    store.dispatch({
      type: `${action.type}_PENDING`,
      payload: action.payload,
      meta: { ...action.meta, action: 'pending', requestId }
    });

    // Execute async operation
    const promise = action.payload?.promise || action.payload;

    return promise
      .then((result: unknown) => {
        store.dispatch({
          type: `${action.type}_FULFILLED`,
          payload: { data: result },
          meta: { ...action.meta, action: 'fulfilled', requestId }
        });
        return result;
      })
      .catch((error: Error) => {
        store.dispatch({
          type: `${action.type}_REJECTED`,
          payload: { error },
          meta: { ...action.meta, action: 'rejected', requestId }
        });
        throw error;
      });
  }

  return next(action);
};

// Action creator helper for async operations
export function createAsyncAction<T = unknown>(
  type: string,
  promise: Promise<T>,
  meta?: Record<string, unknown>
) {
  return {
    type,
    payload: { promise },
    meta: {
      async: true,
      requestId: `async_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ...meta
    }
  };
}

// Action creator for thunks
export function createThunkAction(
  type: string,
  asyncAction: (dispatch: (action: any) => void, getState: () => any) => Promise<unknown> | unknown
) {
  return (dispatch: (action: any) => void, getState: () => any) => {
    dispatch({ type, meta: { thunk: true } });
    return asyncAction(dispatch, getState);
  };
}

// Retry middleware
export const retryMiddleware: Middleware = (store: any) => (next: any) => (action: any) => {
  if (action.meta?.retry) {
    const { maxRetries = 3, delay = 1000 } = action.meta.retry;
    let retryCount = 0;

    const attempt = () => {
      try {
        return next(action);
      } catch (error) {
        retryCount++;

        if (retryCount < maxRetries) {
          console.warn(`Attempt ${retryCount} failed. Retrying...`, error);
          setTimeout(attempt, delay * retryCount);
          return undefined;
        } else {
          console.error('Max retries reached. Giving up.', error);
          throw error;
        }
      }
    };

    return attempt();
  }

  return next(action);
};

// Timeout middleware
export const timeoutMiddleware: Middleware = (store) => (next) => (action) => {
  if (action.meta?.timeout) {
    const { timeout = 5000, timeoutError = 'Action timed out' } = action.meta.timeout;

    return Promise.race([
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(timeoutError));
        }, timeout);
      }),
      new Promise((resolve) => {
        const result = next(action);
        resolve(result);
      })
    ]);
  }

  return next(action);
};

// Cache middleware
export const cacheMiddleware: Middleware = (store) => (next) => (action) => {
  const cache = new Map<string, any>();

  if (action.meta?.cache) {
    const { key, ttl = 60000 } = action.meta.cache;
    const cached = cache.get(key);

    if (cached) {
      const now = Date.now();
      if (now - cached.timestamp < ttl) {
        return cached.data;
      }
    }

    const result = next(action);
    cache.set(key, { data: result, timestamp: Date.now() });
    return result;
  }

  return next(action);
};

// Middleware composition helper
export function composeMiddleware(...middlewares: Middleware[]) {
  return (store: MiddlewareAPI<any>) =>
    middlewares.reduce((next, middleware) => middleware(store)(next),
    (action: BaseAction) => action);
}

// Apply middleware to store
export function applyMiddleware<S>(
  reducer: (state: S, action: BaseAction) => S,
  initialState: S,
  ...middlewares: Middleware[]
) {
  let currentState = initialState;
  const listeners: Array<() => void> = [];

  const store = {
    getState: () => currentState,

    dispatch: (action: BaseAction) => {
      currentState = reducer(currentState, action);
      listeners.forEach(listener => listener());

      return action;
    },

    subscribe: (listener: () => void) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index > -1) {
          listeners.splice(index, 1);
        }
      };
    }
  };

  const dispatchWithMiddleware = composeMiddleware(...middlewares)(store).dispatch;

  return {
    ...store,
    dispatch: dispatchWithMiddleware
  };
}

// Selector helper
export function createSelector<T, R>(
  select: (state: T) => R
) {
  return (state: T): R => select(state);
}

// Memoized selector
export function createMemoizedSelector<T, R>(
  select: (state: T) => R,
  areEqual: (a: R, b: R) => boolean = (a, b) => a === b
) {
  let lastResult: R;

  return (state: T): R => {
    const currentResult = select(state);

    if (areEqual(lastResult, currentResult)) {
      return lastResult;
    }

    lastResult = currentResult;
    return currentResult;
  };
}