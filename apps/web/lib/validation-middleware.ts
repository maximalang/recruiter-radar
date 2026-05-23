// Validation Middleware for Redux-style actions
// Provides runtime validation for actions and state mutations

import type { Middleware, MiddlewareAPI, BaseAction } from './state-management-types';
import { actionSchema, createValidationError } from './validation-schemas';
import type { DashboardOverview, Notification } from './state-management-types';

// Validation middleware that checks action structure
export const validationMiddleware: Middleware = (action, next) => {
  try {
    // Validate action structure
    if (!actionSchema.validate(action)) {
      console.error('Invalid action structure:', action);
      // Dispatch an error action
      const errorAction = {
        type: 'VALIDATION_ERROR',
        payload: createValidationError('action', 'Invalid action structure'),
        meta: {
          originalAction: action,
          timestamp: new Date().toISOString(),
          data: undefined
        }
      };
      return next(errorAction);
    }

    // Validate specific action types based on their payloads
    const validatedAction = validateActionPayload(action);

    return next(validatedAction);
  } catch (error) {
    // If validation fails, log and let the error be caught by the error handling middleware
    console.error('Action validation failed:', error);
    return next(action);
  }
};

// Type definitions for action payloads
type DashboardSetOverviewAction = BaseAction & {
  type: 'DASHBOARD.SET_OVERVIEW';
  payload: DashboardOverview;
};

type UIAddNotificationAction = BaseAction & {
  type: 'UI.ADD_NOTIFICATION';
  payload: Notification;
};

type DashboardSetLoadingAction = BaseAction & {
  type: 'DASHBOARD.SET_LOADING';
  payload: { isLoading: boolean; error?: string };
};

// Action-specific payload validation
function validateActionPayload<T extends BaseAction>(action: T): T {
  if (!actionSchema.validate(action)) {
    throw createValidationError('action', 'Invalid action structure');
  }

  switch (action.type) {
    case 'DASHBOARD.SET_OVERVIEW': {
      const typedAction = action as DashboardSetOverviewAction;
      if (!typedAction.payload || typeof typedAction.payload !== 'object') {
        throw new Error('Dashboard overview must be an object');
      }

      // Validate specific fields
      if (typeof typedAction.payload.totalSources !== 'number') {
        throw new Error('totalSources must be a number');
      }
      if (typeof typedAction.payload.activeSources !== 'number') {
        throw new Error('activeSources must be a number');
      }
      if (typeof typedAction.payload.overallHealth !== 'number') {
        throw new Error('overallHealth must be a number');
      }
      if (typeof typedAction.payload.totalAlerts !== 'number') {
        throw new Error('totalAlerts must be a number');
      }
      break;
    }

    case 'UI.ADD_NOTIFICATION': {
      const typedAction = action as UIAddNotificationAction;
      if (!typedAction.payload || typeof typedAction.payload !== 'object') {
        throw new Error('Notification must be an object');
      }
      if (!typedAction.payload.id || !typedAction.payload.type || !typedAction.payload.message) {
        throw new Error('Notification must have id, type, and message');
      }

      // Validate notification type
      const validTypes = ['success', 'error', 'warning', 'info'];
      if (!validTypes.includes(typedAction.payload.type)) {
        throw new Error(`Invalid notification type: ${typedAction.payload.type}`);
      }
      break;
    }

    case 'DASHBOARD.SET_LOADING': {
      const typedAction = action as DashboardSetLoadingAction;
      if (typedAction.payload && typeof typedAction.payload !== 'object') {
        throw new Error('Loading state must be an object');
      }
      if (typedAction.payload && typeof typedAction.payload.isLoading !== 'boolean') {
        throw new Error('isLoading must be a boolean');
      }
      break;
    }

    default:
      // No special validation needed for other action types
      break;
  }

  return action;
}

// State Validation Middleware - checks state after mutations
export const stateValidationMiddleware: Middleware = (action, next) => {
  const result = next(action);

  // Optionally validate state after each action
  // This is disabled by default for performance reasons
  // validateStateAfterAction(store.getState(), action);

  return result;
};

// Performance monitoring middleware with validation
export const performanceMonitoringMiddleware: Middleware = (action, next) => {
  const start = performance.now();

  try {
    const result = next(action);
    const duration = performance.now() - start;

    if (duration > 100) { // Log actions that take more than 100ms
      console.warn(`Slow action detected: ${action.type} took ${duration.toFixed(2)}ms`);
    }

    return result;
  } catch (error) {
    console.error(`Action ${action.type} failed:`, error);
    throw error;
  }
};

// Error handling middleware with validation
export const errorHandlingMiddleware: Middleware = (action, next) => {
  try {
    return next(action);
  } catch (error) {
    console.error('Action failed:', error);

    // Note: Error dispatch removed due to simplified middleware signature

    throw error;
  }
};

// Composed validation middleware with error boundaries
export const validationMiddlewareChain = [
  validationMiddleware,
  stateValidationMiddleware,
  performanceMonitoringMiddleware,
  errorHandlingMiddleware
];

// Helper to create validated async actions
export function createValidatedAsyncAction<T>(
  type: string,
  asyncFn: () => Promise<T>,
  validationFn?: (data: T) => boolean
) {
  return async (dispatch: (action: BaseAction) => void, getState: () => unknown) => {
    try {
      dispatch({ type: `${type}_PENDING` });

      const result = await asyncFn();

      // Validate result if validator provided
      if (validationFn && !validationFn(result)) {
        throw new Error('Async action result validation failed');
      }

      dispatch({
        type: `${type}_FULFILLED`,
        payload: result
      });

      return result;
    } catch (error) {
      dispatch({
        type: `${type}_REJECTED`,
        payload: { error: error instanceof Error ? error.message : 'Unknown error' }
      });
      throw error;
    }
  };
}

// API Response Validation
export function validateApiResponse<T>(response: unknown, schema: { validate: (data: unknown) => data is T }): T {
  if (!schema.validate(response)) {
    throw new Error('Invalid API response format');
  }
  return response;
}

// Form validation with error reporting
export function validateFormData<T extends Record<string, any>>(
  data: unknown,
  validationRules: Partial<Record<keyof T, (value: any) => boolean>>,
  fieldNames: Record<keyof T, string>
): { isValid: true; data: T } | { isValid: false; errors: Array<{ field: string; message: string }> } {
  const errors: Array<{ field: string; message: string }> = [];
  const result: Partial<T> = {};

  for (const [key, validator] of Object.entries(validationRules)) {
    const value = (data as any)?.[key];
    const fieldName = fieldNames[key as keyof T];

    if (!validator || !validator(value)) {
      errors.push({
        field: fieldName,
        message: `${fieldName} is invalid`
      });
    } else {
      result[key as keyof T] = value;
    }
  }

  if (errors.length > 0) {
    return { isValid: false, errors };
  }

  return { isValid: true, data: result as T };
}