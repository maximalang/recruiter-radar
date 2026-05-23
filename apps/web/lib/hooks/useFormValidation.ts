// Custom hook for form validation with runtime type checking
import { useState, useCallback, useMemo } from 'react';
import {
  formValidation,
  createValidationError
} from '../validation-schemas';

export interface FieldRule<T = any> {
  required?: boolean;
  validator?: (value: T) => boolean;
  message?: string;
  min?: number;
  max?: number;
  pattern?: RegExp;
}

export interface ValidationRule<T = any> {
  [key: string]: FieldRule<T>;
}

export interface FormValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
  validateField: (name: string, value: any) => void;
  validateForm: (data: Record<string, any>) => boolean;
  clearErrors: () => void;
  setError: (name: string, message: string) => void;
  removeError: (name: string) => void;
}

export function useFormValidation<T extends Record<string, any>>(
  initialRules: ValidationRule<T> = {}
): FormValidationResult {
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Validate a single field
  const validateField = useCallback((name: string, value: any): void => {
    const rule = initialRules[name];
    if (!rule) return;

    let error = '';

    // Check required field
    if (rule.required && (value === undefined || value === null || value === '')) {
      error = rule.message || 'This field is required';
    }
    // Custom validator
    else if (rule.validator && !rule.validator(value)) {
      error = rule.message || 'Invalid value';
    }
    // Min length check
    else if (rule.min !== undefined && typeof value === 'string' && value.length < rule.min) {
      error = rule.message || `Minimum ${rule.min} characters required`;
    }
    // Max length check
    else if (rule.max !== undefined && typeof value === 'string' && value.length > rule.max) {
      error = rule.message || `Maximum ${rule.max} characters allowed`;
    }
    // Pattern check
    else if (rule.pattern && typeof value === 'string' && !rule.pattern.test(value)) {
      error = rule.message || 'Invalid format';
    }

    setErrors(prev => ({
      ...prev,
      [name]: error || ''
    }));
  }, [initialRules]);

  // Validate entire form
  const validateForm = useCallback((data: Record<string, any>): boolean => {
    const newErrors: Record<string, string> = {};

    for (const [name, rule] of Object.entries(initialRules)) {
      const value = data[name];

      if (rule.required && (value === undefined || value === null || value === '')) {
        newErrors[name] = rule.message || 'This field is required';
      } else if (rule.validator && !rule.validator(value)) {
        newErrors[name] = rule.message || 'Invalid value';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
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

  // Memoized validation functions to prevent unnecessary re-renders
  const validationMemo = useMemo(() => ({
    isValid: Object.values(errors).every(error => !error),
    errors,
    validateField,
    validateForm,
    clearErrors,
    setError,
    removeError
  }), [errors, validateField, validateForm, clearErrors, setError, removeError]);

  return validationMemo;
}

// Common validation rule presets
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
  },
  confirmPassword: (password: string) => ({
    required: true,
    validator: (value: string) => value === password,
    message: 'Passwords do not match'
  })
};

// Hook for async form submission with validation
export function useAsyncFormSubmit<T>(
  onSubmit: (data: T) => Promise<void>,
  initialData: T,
  validationRules: ValidationRule<T>
) {
  const [formData, setFormData] = useState<T>(initialData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { isValid, errors, validateForm } = useFormValidation<T>(validationRules);

  const handleChange = useCallback((name: keyof T, value: any) => {
    setFormData(prev => ({ ...prev, [name]: value }));
  }, []);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    if (!validateForm(formData)) {
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
  }, [formData, validateForm, onSubmit]);

  return {
    formData,
    setFormData,
    handleChange,
    isSubmitting,
    submitError,
    errors,
    isValid,
    handleSubmit
  };
}