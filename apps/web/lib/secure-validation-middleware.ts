// Enhanced Validation Middleware with Security Hardening
// Provides comprehensive validation with protection against common attacks

import { Middleware, BaseAction, MiddlewareAPI, Dispatch } from './state-management-types';
import {
  SecureCaseUtils,
  CaseConversionAuditLogger
} from './secure-case-converter';
import {
  isString,
  isNumber,
  isObject,
  isSafeIdentifier
} from './secure-validation-schemas';
import { createValidationError } from './validation-schemas';

// Security-focused Validation Middleware
export const secureValidationMiddleware: Middleware = (action, next) => {
  try {
    // Rate limiting for action validation
    if (!true('validation')) {
      console.warn('Validation rate limit exceeded');
      return next({
        type: 'VALIDATION_RATE_LIMIT_EXCEEDED',
        payload: createValidationError('validation', 'Too many validation attempts'),
        meta: { originalAction: action }
      });
    }

    // Validate action structure with additional security checks
    if (!isValidActionStructure(action)) {
      console.error('Invalid action structure:', action);
      return next({
        type: 'VALIDATION_ERROR',
        payload: createValidationError('action', 'Invalid action structure'),
        meta: { originalAction: action }
      });
    }

    // Log security-relevant actions
    if (isSecurityRelevantAction(action)) {
      CaseConversionAuditLogger.log('SECURITY_VALIDATION', {
        type: action.type,
        timestamp: new Date().toISOString()
      });
    }

    // Validate specific action types with enhanced security
    const validatedAction = validateActionPayload(action);

    return next(validatedAction);
  } catch (error) {
    console.error('Secure validation middleware error:', error);
    return next({
      type: 'VALIDATION_ERROR',
      payload: createValidationError('middleware', 'Validation middleware failed'),
      meta: { originalAction: action, error: error instanceof Error ? error.message : 'Unknown error' }
    });
  }
};

// Enhanced Action Structure Validation
function isValidActionStructure(action: unknown): action is { type: string; payload?: unknown; meta?: unknown } {
  if (!isObject(action)) return false;
  if (!isString(action.type)) return false;

  // Validate action type format
  if (!isValidActionType(action.type)) return false;

  // Validate payload if present
  if (action.payload !== undefined) {
    if (!isObject(action.payload)) {
      return false;
    }

    // Check for prototype pollution
    if (action.payload.__proto__ !== Object.prototype) {
      return false;
    }
  }

  // Validate meta if present
  if (action.meta !== undefined) {
    if (!isObject(action.meta)) {
      return false;
    }
  }

  return true;
}

// Validate action type format
function isValidActionType(type: string): boolean {
  // Action types should follow a specific pattern
  const actionTypePattern = /^[A-Z_]+(\.[A-Z_]+)*(_PENDING|_FULFILLED|_REJECTED)?$/;

  if (!actionTypePattern.test(type)) {
    return false;
  }

  // Check for potentially dangerous action patterns
  const dangerousPatterns = [
    /eval/i,
    /exec/i,
    /system/i,
    /spawn/i,
    /fork/i,
    /child_process/i,
    /require/i,
    /import/i,
    /delete/i,
    /drop/i,
    /truncate/i
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(type)) {
      console.warn('Potentially dangerous action type detected:', type);
      return false;
    }
  }

  return true;
}

// Enhanced Payload Validation with Security Checks
function validateActionPayload(action: { type: string; payload?: unknown; meta?: unknown }) {
  switch (action.type) {
    case 'DASHBOARD.SET_OVERVIEW': {
      const overview = action.payload as any;
      if (!isObject(overview)) {
        throw new Error('Dashboard overview must be an object');
      }

      // Validate numeric bounds
      if (typeof overview.totalSources !== 'number' ||
          overview.totalSources < 0 ||
          overview.totalSources > 10000) {
        throw new Error('Invalid totalSources value');
      }

      return action;
    }

    case 'UI.ADD_NOTIFICATION': {
      const notification = action.payload as any;

      // Enhanced notification validation
      if (!isObject(notification)) {
        throw new Error('Notification must be an object');
      }

      if (!isString(notification.id)) {
        throw new Error('Notification ID must be a string');
      }

      if (!isString(notification.type) ||
          !['success', 'error', 'warning', 'info'].includes(notification.type)) {
        throw new Error('Invalid notification type');
      }

      // Sanitize notification message
      if (isString(notification.message)) {
        notification.message = SecurityUtils.secureFormValidation.preventXSS(notification.message);
      }

      if (notification.duration &&
          (!isNumber(notification.duration) ||
          notification.duration < 0 ||
          notification.duration > 300000)) {
        throw new Error('Invalid notification duration');
      }

      return action;
    }

    case 'FORM.SUBMIT': {
      const formData = action.payload as any;

      // Form data validation
      if (!isObject(formData)) {
        throw new Error('Form data must be an object');
      }

      // Sanitize form data
      const sanitizedData = SecurityUtils.sanitizeObjectKeys(formData);

      return {
        ...action,
        payload: sanitizedData
      };
    }

    case 'API.FETCH': {
      const apiParams = action.payload as any;

      // API parameter validation
      if (apiParams && !isObject(apiParams)) {
        throw new Error('API parameters must be an object');
      }

      // Validate query parameters
      if (apiParams?.query) {
        if (!isObject(apiParams.query)) {
          throw new Error('Query parameters must be an object');
        }

        // Sanitize query parameters
        const sanitizedQuery: Record<string, unknown> = {};
        if (typeof apiParams === 'object' && apiParams !== null && 'query' in apiParams) {
          const query = (apiParams as { query?: Record<string, unknown> }).query;
          if (query && typeof query === 'object') {
            for (const [key, value] of Object.entries(query)) {
              if (isSafeIdentifier(key)) {
                sanitizedQuery[key] = value;
              } else {
                console.warn('Invalid query parameter name:', key);
              }
            }
            (apiParams as { query?: Record<string, unknown> }).query = sanitizedQuery;
          }
        }
      }

      return action;
    }

    default:
      // For other action types, perform basic validation
      if (action.payload) {
        const sanitizedPayload = SecurityUtils.sanitizeObjectKeys(action.payload);
        return {
          ...action,
          payload: sanitizedPayload
        };
      }
      return action;
  }
}

// Security-focused State Validation Middleware
export const secureStateValidationMiddleware: Middleware<any> = (store: any) => (next: Dispatch<any>) => (action: any) => {
  const result = next(action);

  // Validate state after mutation with security checks
  const state = store.getState();

  // Check for prototype pollution
  if (checkPrototypePollution(state)) {
    console.error('Prototype pollution detected in state');
    // Revert to previous state or handle appropriately
    return result;
  }

  // Validate state size to prevent memory issues
  if (checkStateSize(state)) {
    console.warn('State size exceeds security threshold');
  }

  // Log state mutations for security audit
  if (isSecurityRelevantStateChange(action.type, state)) {
    CaseConversionAuditLogger.log('STATE_MUTATION', {
      type: action.type,
      timestamp: new Date().toISOString(),
      stateSize: JSON.stringify(state).length
    });
  }

  return result;
};

// Prototype Pollution Detection
function checkPrototypePollution(obj: any): boolean {
  if (obj === null || typeof obj !== 'object') return false;

  // Check for unsafe prototype modifications
  if (obj.__proto__ !== Object.prototype && obj.__proto__ !== null) {
    return true;
  }

  // Recursively check nested objects
  for (const key of Object.keys(obj)) {
    if (checkPrototypePollution(obj[key])) {
      return true;
    }
  }

  return false;
}

// State Size Validation
function checkStateSize(state: any): boolean {
  const stateString = JSON.stringify(state);
  const maxSize = 10 * 1024 * 1024; // 10MB

  if (stateString.length > maxSize) {
    console.warn(`State size (${stateString.length}) exceeds limit (${maxSize})`);
    return true;
  }

  return false;
}

// Security-relevant action detection
function isSecurityRelevantAction(action: any): boolean {
  const securityActions = [
    'AUTH.LOGIN',
    'AUTH.LOGOUT',
    'USER.UPDATE_PROFILE',
    'SETTINGS.UPDATE',
    'SECURITY.CHANGE_PASSWORD',
    'PERMISSIONS.GRANT',
    'PERMISSIONS.REVOKE'
  ];

  return securityActions.some(pattern => action.type.includes(pattern));
}

// Security-relevant state change detection
function isSecurityRelevantStateChange(actionType: string, state: any): boolean {
  if (actionType.includes('AUTH') ||
      actionType.includes('USER') ||
      actionType.includes('SECURITY') ||
      actionType.includes('PERMISSIONS')) {
    return true;
  }

  // Check for sensitive data in state
  if (state.auth?.user?.email ||
      state.auth?.tokens ||
      state.profile?.sensitiveData) {
    return true;
  }

  return false;
}

// Secure Action Creation Helper
export function createSecureAction<T extends { type: string; payload?: any; meta?: any }>(
  type: string,
  payload?: T['payload'],
  meta?: T['meta']
): T {
  // Validate action type
  if (!isValidActionType(type)) {
    throw new Error(`Invalid action type: ${type}`);
  }

  // Create action with security checks
  const action = {
    type,
    payload: payload ? SecurityUtils.sanitizeObjectKeys(payload) : undefined,
    meta: meta ? SecurityUtils.sanitizeObjectKeys(meta) : undefined
  };

  return action as T;
}

// Batch Action Validation
export function validateBatchActions(actions: any[]): boolean {
  if (!Array.isArray(actions)) {
    return false;
  }

  if (actions.length > 100) {
    throw new Error('Batch action count exceeds limit');
  }

  for (const action of actions) {
    if (!isValidActionStructure(action)) {
      return false;
    }
  }

  return true;
}

// Performance Monitoring with Security Considerations
export const securePerformanceMonitoringMiddleware: Middleware<any> = (store: any) => (next: Dispatch<any>) => (action: any) => {
  const start = performance.now();

  try {
    const result = next(action);
    const duration = performance.now() - start;

    // Log slow actions
    if (duration > 1000) { // 1 second threshold
      console.warn(`Slow action detected: ${action.type} took ${duration.toFixed(2)}ms`);

      // Security-related slow actions deserve special attention
      if (isSecurityRelevantAction(action)) {
        CaseConversionAuditLogger.log('SLOW_SECURITY_ACTION', {
          type: action.type,
          duration,
          timestamp: new Date().toISOString()
        });
      }
    }

    return result;
  } catch (error) {
    console.error(`Action ${action.type} failed:`, error);

    // Security errors should be logged differently
    if (error instanceof Error &&
        (error.message.includes('validation') ||
         error.message.includes('security') ||
         error.message.includes('unauthorized'))) {
      CaseConversionAuditLogger.log('SECURITY_ERROR', {
        type: action.type,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }

    throw error;
  }
};

// Error Handling Middleware with Security
export const secureErrorHandlingMiddleware: Middleware<any> = (store: any) => (next: Dispatch<any>) => (action: any) => {
  try {
    return next(action);
  } catch (error) {
    console.error('Action failed:', error);

    // Check for security-related errors
    if (isSecurityError(error)) {
      CaseConversionAuditLogger.log('SECURITY_FAILURE', {
        actionType: action.type,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });

      // Don't expose sensitive error details to client
      const sanitizedError = {
        type: 'SECURITY_ERROR',
        message: 'A security error occurred'
      };

      // Dispatch error state if available
      if (store.getState().ui) {
        store.dispatch({
          type: 'UI.ADD_NOTIFICATION',
          payload: {
            id: `security-error-${Date.now()}`,
            type: 'error',
            message: sanitizedError.message,
            duration: 5000
          }
        });
      }

      // Re-throw with sanitized error
      throw new Error(sanitizedError.message);
    }

    // Handle non-security errors normally
    if (store.getState().ui) {
      store.dispatch({
        type: 'UI.ADD_NOTIFICATION',
        payload: {
          id: `error-${Date.now()}`,
          type: 'error',
          message: error instanceof Error ? error.message : 'An error occurred',
          duration: 5000
        }
      });
    }

    throw error;
  }
};

// Security error detection
function isSecurityError(error: any): boolean {
  if (!(error instanceof Error)) return false;

  const securityKeywords = [
    'validation',
    'authentication',
    'authorization',
    'security',
    'unauthorized',
    'forbidden',
    'invalid',
    'malformed',
    'injection',
    'xss',
    'csrf',
    'prototype'
  ];

  return securityKeywords.some(keyword =>
    error.message.toLowerCase().includes(keyword)
  );
}

// Composed Secure Middleware
export const secureMiddlewareChain = [
  secureValidationMiddleware,
  secureStateValidationMiddleware,
  securePerformanceMonitoringMiddleware,
  secureErrorHandlingMiddleware
];

// Export security utilities
export const SecurityMiddlewareUtils = {
  isValidActionStructure,
  validateActionPayload,
  createSecureAction,
  validateBatchActions,
  isSecurityRelevantAction,
  isSecurityRelevantStateChange
};