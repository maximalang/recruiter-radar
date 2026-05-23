// Unified validation system combining validation-schemas and validation-middleware
import { useState, useCallback } from 'react';
import type { BaseAction, Middleware } from '../state-management-types';
import type { ValidationRule, FieldRule } from '../hooks/useFormValidation';

// Utility functions (moved from validation-schemas.ts)
export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value);
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

export function isDate(value: unknown): value is Date {
  return value instanceof Date && !isNaN(value.getTime());
}

export function isDateString(value: unknown): value is string {
  if (!isString(value)) return false;
  return !isNaN(Date.parse(value));
}

export function isArray<T>(value: unknown, itemValidator?: (item: unknown) => item is T): value is T[] {
  if (!Array.isArray(value)) return false;
  if (itemValidator) return value.every(itemValidator);
  return true;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Validation result types
export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
  error?: string;
}

export interface FormValidationResult extends ValidationResult {
  validateField: (name: string, value: unknown) => void;
  validateForm: (data: Record<string, unknown>) => boolean;
  clearErrors: () => void;
  setError: (name: string, message: string) => void;
  removeError: (name: string) => void;
}

// Action validation
export const actionSchema = {
  validate: (data: unknown): data is { type: string; payload?: unknown; meta?: unknown } => {
    return isObject(data) &&
      isString(data.type) &&
      (data.payload === undefined || isObject(data.payload)) &&
      (data.meta === undefined || isObject(data.meta));
  }
};

// Error handling
export function createValidationError(field: string, message: string) {
  return {
    field,
    message,
    timestamp: new Date().toISOString()
  };
}

export function isValidationError(error: unknown): error is { field: string; message: string } {
  return isObject(error) && isString(error.field) && isString(error.message);
}

// Form validation
export function validateField(
  name: string,
  value: unknown,
  rule: FieldRule
): string | null {
  // Check required field
  if (rule.required && (value === undefined || value === null || value === '')) {
    return rule.message || 'This field is required';
  }

  // Custom validator
  if (rule.validator && !rule.validator(value)) {
    return rule.message || 'Invalid value';
  }

  // Min length check
  if (rule.min !== undefined && typeof value === 'string' && value.length < rule.min) {
    return rule.message || `Minimum ${rule.min} characters required`;
  }

  // Max length check
  if (rule.max !== undefined && typeof value === 'string' && value.length > rule.max) {
    return rule.message || `Maximum ${rule.max} characters allowed`;
  }

  // Pattern check
  if (rule.pattern && typeof value === 'string' && !rule.pattern.test(value)) {
    return rule.message || 'Invalid format';
  }

  return null;
}

export function validateForm<T extends Record<string, unknown>>(
  data: Record<string, unknown>,
  rules: ValidationRule<T>
): ValidationResult {
  const errors: Record<string, string> = {};

  for (const [name, rule] of Object.entries(rules)) {
    const value = data[name];
    const error = validateField(name, value, rule as any);

    if (error) {
      errors[name] = error;
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors
  };
}

// Action validation middleware
export function validateAction(
  action: BaseAction,
  options?: { type?: 'dashboard' | 'form' | 'ui' }
): ValidationResult {
  try {
    // Validate action structure
    if (!actionSchema.validate(action)) {
      return {
        valid: false,
        errors: {
          action: 'Invalid action structure'
        },
        error: 'Invalid action structure'
      };
    }

    // Type-specific validation
    switch (options?.type) {
      case 'dashboard': {
        if (action.type === 'DASHBOARD.SET_OVERVIEW') {
          const payload = action.payload as any;
          const errors: Record<string, string> = {};

          if (typeof payload.totalSources !== 'number') {
            errors.totalSources = 'totalSources must be a number';
          }
          if (typeof payload.activeSources !== 'number') {
            errors.activeSources = 'activeSources must be a number';
          }
          if (typeof payload.overallHealth !== 'number') {
            errors.overallHealth = 'overallHealth must be a number';
          }
          if (typeof payload.totalAlerts !== 'number') {
            errors.totalAlerts = 'totalAlerts must be a number';
          }

          if (Object.keys(errors).length > 0) {
            return {
              valid: false,
              errors
            };
          }
        }
        break;
      }

      case 'form': {
        if (action.type === 'FORM.SUBMIT') {
          const payload = action.payload as any;
          const errors: Record<string, string> = {};

          if (!payload || typeof payload !== 'object') {
            errors.form = 'Form data must be an object';
          } else {
            // Basic form validation
            if (!payload.email) {
              errors.email = 'Email is required';
            }
          }

          if (Object.keys(errors).length > 0) {
            return {
              valid: false,
              errors
            };
          }
        }
        break;
      }
    }

    return {
      valid: true,
      errors: {}
    };
  } catch (error) {
    return {
      valid: false,
      errors: {
        action: error instanceof Error ? error.message : 'Unknown error'
      },
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Unified validation middleware
export const validationMiddleware: Middleware = (action, next) => {
  try {
    // Validate action structure
    const validationResult = validateAction(action);

    if (!validationResult.valid) {
      console.error('Action validation failed:', validationResult.errors);

      return next({
        type: 'VALIDATION_ERROR',
        payload: createValidationError('action', 'Invalid action structure'),
        meta: {
          timestamp: new Date().toISOString(),
          data: validationResult.errors
        }
      });
    }

    return next(action);
  } catch (error) {
    console.error('Action validation failed:', error);
    return next({
      type: 'VALIDATION_ERROR',
      payload: createValidationError('action', error instanceof Error ? error.message : 'Unknown error'),
      meta: {
        originalAction: action,
        timestamp: new Date().toISOString()
      }
    });
  }
};

// Validator factory for reusable validation
export function createValidator<T extends Record<string, unknown>>(
  rules: ValidationRule<T>
) {
  return (data: Record<string, unknown>): ValidationResult => {
    return validateForm(data, rules);
  };
}

// Hook for form validation (replaces useFormValidation)
export function useFormValidation<T extends Record<string, any>>(
  initialRules: ValidationRule<T> = {}
): FormValidationResult {
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Validate a single field
  const validateField = useCallback((name: string, value: unknown): void => {
    const rule = initialRules[name];
    if (!rule) return;

    const error = validateField(name, value, rule as any);
    setErrors(prev => ({
      ...prev,
      [name]: error || ''
    }));
  }, [initialRules]);

  // Validate entire form
  const validateFormCallback = useCallback((data: Record<string, any>): boolean => {
    const result = validateForm(data, initialRules);
    setErrors(result.errors);
    return result.valid;
  }, [initialRules]);

  // Clear all errors
  const clearErrors = useCallback(() => {
    setErrors({});
  }, []);

  // Set specific error
  const setError = useCallback((name: string, message: string) => {
    setErrors(prev => ({ ...prev, [name]: message }));
  }, []);

  // Remove specific error
  const removeError = useCallback((name: string) => {
    setErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors[name];
      return newErrors;
    });
  }, []);

  return {
    valid: Object.values(errors).every(error => !error),
    errors,
    validateField,
    validateForm: validateFormCallback,
    clearErrors,
    setError,
    removeError
  };
}

// Async form submission hook
export function useAsyncFormSubmit<T extends Record<string, any>>(
  onSubmit: (data: T) => Promise<void>,
  initialData: T,
  validationRules: ValidationRule<T>
) {
  const [formData, setFormData] = useState<T>(initialData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { valid, errors, validateForm: validateFormCallback } = useFormValidation<T>(validationRules);

  const handleChange = useCallback((name: keyof T, value: any) => {
    setFormData(prev => ({ ...prev, [name]: value }));
  }, []);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    if (!validateFormCallback(formData)) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      await onSubmit(formData);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Submission failed');
    } finally {
      setIsSubmitting(false);
    }
  }, [formData, validateFormCallback, onSubmit]);

  return {
    formData,
    setFormData,
    handleChange,
    isSubmitting,
    submitError,
    errors,
    valid,
    handleSubmit
  };
}