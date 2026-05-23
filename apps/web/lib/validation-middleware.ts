// Enhanced validation middleware using the new validation system
import {
  validationMiddleware as unifiedValidationMiddleware,
  validateAction as validateActionInternal,
  ValidationResult,
  createValidationError
} from './validation/validation-system';
import { EnhancedMiddleware, MiddlewareAPI, Dispatch } from './state-management-types';

// Create enhanced validation middleware with error handling
export const createValidationMiddleware = (): EnhancedMiddleware => {
  return (store: any, next: any) => (action: any) => {
    try {
      // Validate action structure
      const result = validateActionInternal(action);

      if (!result.valid) {
        console.error('Action validation failed:', result.errors);

        // Dispatch validation error if enabled
        if (typeof store.getState() === 'object' && (store.getState() as any).config?.enableValidationErrors) {
          return next({
            type: 'VALIDATION_ERROR',
            payload: createValidationError('action', 'Invalid action structure'),
            meta: {
              timestamp: new Date().toISOString(),
              data: result.errors
            }
          });
        }

        // Otherwise, log and continue
        console.warn('Action validation failed, continuing anyway:', result.errors);
      }

      return next(action);
    } catch (error) {
      console.error('Validation middleware error:', error);

      // Dispatch error if enabled
      if (store.getState().config?.enableValidationErrors) {
        return next({
          type: 'VALIDATION_ERROR',
          payload: createValidationError('action', error instanceof Error ? error.message : 'Unknown error'),
          meta: {
            originalAction: action,
            timestamp: new Date().toISOString()
          }
        } as any);
      }

      throw error;
    }
  };
};

// Re-export the unified validation middleware for backward compatibility
export { validationMiddleware } from './validation/validation-system';

// Export enhanced middleware
export const enhancedValidationMiddleware = createValidationMiddleware();

// For backward compatibility, keep the old name
export default enhancedValidationMiddleware;