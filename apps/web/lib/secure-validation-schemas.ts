// Enhanced Security Validation Schemas with additional protection layers
// Provides runtime validation with security hardening against common attacks

import type {
  DashboardState,
  DigestState,
  ClientProfileState,
  UIState,
  Notification,
  BaseAction,
  CombinedState
} from './state-management-types';

// Security-focused utility functions with additional checks
export function isString(value: unknown): value is string {
  // Additional security checks to prevent prototype pollution and other attacks
  if (typeof value !== 'string') return false;
  // Check for string pollution
  if ((value as any).__proto__ !== String.prototype) return false;
  // Check for overly long strings that might cause DoS
  if (value.length > 10000) {
    console.warn('String length exceeds security threshold');
    return false;
  }
  return true;
}

export function isNumber(value: unknown): value is number {
  if (typeof value !== 'number' || isNaN(value)) return false;
  // Prevent NaN and Infinity
  if (!isFinite(value)) return false;
  // Prevent extremely large numbers that might cause issues
  if (Math.abs(value) > Number.MAX_SAFE_INTEGER) {
    console.warn('Number exceeds safe integer range');
    return false;
  }
  return true;
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

export function isDate(value: unknown): value is Date {
  return value instanceof Date && !isNaN(value.getTime());
}

export function isDateString(value: unknown): value is string {
  if (!isString(value)) return false;
  // Validate ISO 8601 format strictly
  const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/;
  if (!isoRegex.test(value)) return false;
  const date = new Date(value);
  return !isNaN(date.getTime());
}

// Secure array validation with size limits
export function isArray<T>(value: unknown, itemValidator?: (item: unknown) => item is T, maxSize = 1000): value is T[] {
  if (!Array.isArray(value)) return false;
  if (value.length > maxSize) {
    console.warn(`Array size ${value.length} exceeds security limit of ${maxSize}`);
    return false;
  }
  if (itemValidator) return value.every(itemValidator);
  return true;
}

// Secure object validation with depth limits
export function isObject(value: unknown, maxDepth = 5, currentDepth = 0): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  if (currentDepth >= maxDepth) {
    console.warn(`Object depth ${currentDepth} exceeds security limit of ${maxDepth}`);
    return false;
  }

  // Check for prototype pollution
  if ((value as any).__proto__ !== Object.prototype && (value as any).__proto__ !== null) {
    return false;
  }

  // Recursively check object properties
  for (const key of Object.keys(value)) {
    if (!isString(key)) return false;
    const child = (value as any)[key];
    if (child !== null && typeof child === 'object') {
      if (!isObject(child, maxDepth, currentDepth + 1)) return false;
    }
  }

  return true;
}

// Safe identifier validation for query parameters and API keys
export function isSafeIdentifier(value: unknown): value is string {
  if (!isString(value)) return false;

  // Allow alphanumeric, underscore, hyphen, and dots
  const safePattern = /^[a-zA-Z0-9_\-\.]+$/;
  return safePattern.test(value);
}

// Sanitization utilities
export function sanitizeString(input: unknown, maxLength = 1000): string {
  if (!isString(input)) return '';
  // Remove control characters except for common ones (tab, newline, carriage return)
  return input
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .substring(0, maxLength);
}

export function sanitizeObjectKeys(obj: unknown): Record<string, unknown> {
  if (!isObject(obj)) return {};
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(obj)) {
    const sanitizedKey = sanitizeString(key).replace(/[^\w\s-]/g, '_');
    const value = (obj as any)[key];

    if (value === null || typeof value !== 'object') {
      result[sanitizedKey] = value;
    } else {
      result[sanitizedKey] = sanitizeObjectKeys(value);
    }
  }

  return result;
}

// Enhanced Dashboard Overview Schema with security checks
export const dashboardOverviewSchema = {
  validate: (data: unknown): data is DashboardState['overview'] => {
    return isObject(data) &&
      isNumber(data.totalSources) &&
      data.totalSources >= 0 && data.totalSources <= 10000 && // Realistic upper bound
      isNumber(data.activeSources) &&
      data.activeSources >= 0 && data.activeSources <= data.totalSources &&
      isNumber(data.overallHealth) &&
      data.overallHealth >= 0 && data.overallHealth <= 100 &&
      isNumber(data.totalAlerts) &&
      data.totalAlerts >= 0 && data.totalAlerts <= 1000 &&
      isDateString(data.lastUpdated);
  },

  safeParse: (data: unknown) => {
    // Sanitize input before validation
    const sanitized = isObject(data) ? sanitizeObjectKeys(data) : null;

    if (dashboardOverviewSchema.validate(sanitized)) {
      return { success: true, data: sanitized };
    }
    return { success: false, error: 'Invalid dashboard overview data' };
  }
};

// Enhanced Notification Schema with security checks
export const notificationSchema = {
  validate: (data: unknown): data is Notification => {
    return isObject(data) &&
      isString(data.id) &&
      data.id.length <= 255 && // Reasonable length limit
      isString(data.type) &&
      ['success', 'error', 'warning', 'info'].includes(data.type) &&
      isString(data.message) &&
      data.message.length <= 1000 && // Message length limit
      isNumber(data.duration) &&
      data.duration >= 0 && data.duration <= 300000 && // Max 5 minutes
      (data.actions === undefined ||
        (Array.isArray(data.actions) &&
         data.actions.length <= 10 && // Limit number of actions
         data.actions.every(action =>
           isObject(action) &&
           isString(action.label) &&
           action.label.length <= 100
         )));
  },

  safeParse: (data: unknown) => {
    if (!isObject(data)) {
      return { success: false, error: 'Notification must be an object' };
    }

    // Sanitize message to prevent XSS
    const sanitized = {
      ...data,
      message: sanitizeString(data.message)
    };

    if (notificationSchema.validate(sanitized)) {
      return { success: true, data: sanitized };
    }
    return { success: false, error: 'Invalid notification data' };
  }
};

// Secure Form Validation with additional security measures
export const secureFormValidation = {
  email: (email: string): { valid: boolean; sanitized?: string } => {
    if (!isString(email)) return { valid: false };

    // Sanitize email before validation
    const sanitized = email.toLowerCase().trim();

    // Stronger email regex
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

    if (email.length > 254) { // Max email length per RFC
      return { valid: false };
    }

    if (emailRegex.test(sanitized)) {
      return { valid: true, sanitized };
    }

    return { valid: false };
  },

  phone: (phone: string): { valid: boolean; sanitized?: string } => {
    if (!isString(phone)) return { valid: false };

    // Sanitize: remove all non-digit characters except +, -, (, ), and space
    const sanitized = phone.replace(/[^\d\-\+\(\)\s]/g, '');

    // Basic phone validation (allowing for various formats)
    const phoneRegex = /^\+?[\d\s\-\(\)]+$/;
    if (sanitized.length < 5 || sanitized.length > 20) {
      return { valid: false };
    }

    if (phoneRegex.test(sanitized)) {
      return { valid: true, sanitized };
    }

    return { valid: false };
  },

  url: (url: string): { valid: boolean; sanitized?: string } => {
    if (!isString(url)) return { valid: false };

    // Remove whitespace
    const trimmed = url.trim();

    // Basic validation before URL constructor
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      return { valid: false };
    }

    try {
      const urlObj = new URL(trimmed);
      // Only allow http and https protocols
      if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
        return { valid: false };
      }
      return { valid: true, sanitized: trimmed };
    } catch {
      return { valid: false };
    }
  },

  required: (value: unknown): boolean => {
    return value !== undefined && value !== null && value !== '';
  },

  // Additional security validators
  preventXSS: (input: unknown): string => {
    if (!isString(input)) return '';

    // Basic XSS prevention
    return input
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '');
  }
};

// Security-focused Action Validator
export const secureActionSchema = {
  validate: (data: unknown): { valid: boolean; sanitized?: any } => {
    if (!isObject(data)) {
      return { valid: false };
    }

    // Sanitize action data
    const sanitized = {
      type: sanitizeString(data.type),
      payload: data.payload ? sanitizeObjectKeys(data.payload) : undefined,
      meta: data.meta ? sanitizeObjectKeys(data.meta) : undefined
    };

    // Validate action type
    if (!isString(sanitized.type) || sanitized.type.length > 100) {
      return { valid: false };
    }

    // Check for potentially dangerous action patterns
    const dangerousPatterns = [
      /eval/i,
      /exec/i,
      /system/i,
      /spawn/i,
      /fork/i
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(sanitized.type)) {
        console.warn('Potentially dangerous action type detected:', sanitized.type);
        return { valid: false };
      }
    }

    return { valid: true, sanitized };
  }
};

// Rate limiting validation
export class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private maxRequests = 100; // requests per window
  private windowMs = 60000; // 1 minute

  isAllowed(key: string): boolean {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let requests = this.requests.get(key) || [];

    // Filter out old requests
    requests = requests.filter(time => time > windowStart);

    if (requests.length >= this.maxRequests) {
      return false;
    }

    requests.push(now);
    this.requests.set(key, requests);

    return true;
  }

  reset(): void {
    this.requests.clear();
  }
}

// Global rate limiter for validation operations
export const validationRateLimiter = new RateLimiter();

// Secure validation with rate limiting
export function secureValidate<T>(data: unknown, validator: (data: unknown) => data is T): {
  valid: boolean;
  data?: T;
  error?: string;
} {
  const key = 'validation_' + Date.now();

  // Check rate limit
  if (!validationRateLimiter.isAllowed(key)) {
    return { valid: false, error: 'Too many validation attempts' };
  }

  if (validator(data)) {
    return { valid: true, data: data as T };
  }

  return { valid: false, error: 'Validation failed' };
}

// Security audit logging
export class SecurityAuditLogger {
  private static logs: Array<{ timestamp: string; action: string; details: any }> = [];

  static log(action: string, details: any): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      action,
      details: sanitizeObjectKeys(details)
    };

    this.logs.push(logEntry);

    // Keep only last 1000 logs
    if (this.logs.length > 1000) {
      this.logs = this.logs.slice(-1000);
    }

    // In production, this would send to a secure logging service
    if (process.env.NODE_ENV === 'development') {
      console.log('[Security Audit]', logEntry);
    }
  }

  static getLogs(): Array<{ timestamp: string; action: string; details: any }> {
    return [...this.logs];
  }

  static clearLogs(): void {
    this.logs = [];
  }
}

// Export security utilities
export const SecurityUtils = {
  sanitizeString,
  sanitizeObjectKeys,
  secureValidate,
  validationRateLimiter,
  SecurityAuditLogger,
  secureFormValidation
};