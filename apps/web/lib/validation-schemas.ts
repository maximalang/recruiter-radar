// Runtime validation schemas using Zod pattern
// These schemas provide runtime type validation without requiring zod installation

import type {
  DashboardOverview,
  DashboardState,
  DigestState,
  ClientProfileState,
  UIState,
  Notification,
  DataSource,
  Alert,
  DigestRun,
  DigestHistoryItem,
  DigestSettings,
  ClientProfile,
  LoadingState
} from './state-management-types';

// Utility functions for type validation at runtime
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
  return isString(value) && !isNaN(Date.parse(value));
}

export function isArray<T>(value: unknown, itemValidator?: (item: unknown) => item is T): value is T[] {
  if (!Array.isArray(value)) return false;
  if (itemValidator) return value.every(itemValidator);
  return true;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Dashboard Overview Schema
export const dashboardOverviewSchema = {
  validate: (data: unknown): data is DashboardOverview => {
    return isObject(data) &&
      isNumber(data.totalSources) &&
      isNumber(data.activeSources) &&
      isNumber(data.overallHealth) &&
      isNumber(data.totalAlerts) &&
      isDateString(data.lastUpdated);
  },

  safeParse: (data: unknown) => {
    if (dashboardOverviewSchema.validate(data)) {
      return { success: true, data };
    }
    return { success: false, error: 'Invalid dashboard overview data' };
  }
};

// Dashboard State Schema
export const dashboardStateSchema = {
  validate: (data: unknown): data is DashboardState => {
    return isObject(data) &&
      dashboardOverviewSchema.validate(data.overview) &&
      isArray(data.sources) &&
      isArray(data.alerts) &&
      isObject(data.loading);
  }
};

// Digest Run Schema
export const digestRunSchema = {
  validate: (data: unknown): data is DigestRun => {
    return isObject(data) &&
      isString(data.status) &&
      isNumber(data.progress) &&
      (data.status === 'idle' || data.status === 'running' || data.status === 'completed');
  }
};

// Digest Settings Schema
export const digestSettingsSchema = {
  validate: (data: unknown): data is DigestSettings => {
    return isObject(data) &&
      isBoolean(data.autoRefresh) &&
      isNumber(data.refreshInterval) &&
      isNumber(data.maxItems) &&
      isObject(data.filters) &&
      isArray(data.filters.confidenceGates, (item): item is string => isString(item)) &&
      isArray(data.filters.sources, (item): item is string => isString(item));
  }
};

// Digest History Item Schema
export const digestHistoryItemSchema = {
  validate: (data: unknown): data is DigestHistoryItem => {
    return isObject(data) &&
      isString(data.id) &&
      isString(data.digest_run_id) &&
      isString(data.org_id) &&
      isNumber(data.total_candidates) &&
      isNumber(data.confident_matches) &&
      isString(data.timestamp) &&
      (data.status === 'idle' || data.status === 'running' || data.status === 'completed');
  }
};

// Digest State Schema
export const digestStateSchema = {
  validate: (data: unknown): data is DigestState => {
    return isObject(data) &&
      digestRunSchema.validate(data.currentRun) &&
      isArray(data.history, (item): item is DigestHistoryItem => digestHistoryItemSchema.validate(item)) &&
      digestSettingsSchema.validate(data.settings) &&
      isObject(data.loading);
  }
};

// Client Profile Schema
export const clientProfileSchema = {
  validate: (data: unknown): data is ClientProfile => {
    return data === null || (
      isObject(data) &&
      isString(data.id) &&
      isString(data.name) &&
      isString(data.org_id) &&
      isString(data.industry) &&
      isString(data.location) &&
      isArray(data.icp_metrics, (item): item is string => isString(item)) &&
      isString(data.created_at) &&
      isString(data.updated_at)
    );
  }
};

// Client Profile State Schema
export const clientProfileStateSchema = {
  validate: (data: unknown): data is ClientProfileState => {
    return isObject(data) &&
      (data.currentProfile === null || clientProfileSchema.validate(data.currentProfile)) &&
      isArray(data.profiles, (item): item is ClientProfile => clientProfileSchema.validate(item)) &&
      isBoolean(data.isEditing) &&
      isObject(data.loading);
  }
};

// Notification Schema
export const notificationSchema = {
  validate: (data: unknown): data is Notification => {
    return isObject(data) &&
      isString(data.id) &&
      isString(data.type) &&
      isString(data.message) &&
      isNumber(data.duration) &&
      (data.type === 'success' || data.type === 'error' || data.type === 'warning' || data.type === 'info') &&
      (data.actions === undefined || (Array.isArray(data.actions) && data.actions.length > 0 &&
        isObject(data.actions[0]) &&
        isString(data.actions[0].label)
      ));
  }
};

// UI State Schema
export const uiStateSchema = {
  validate: (data: unknown): data is UIState => {
    return isObject(data) &&
      isString(data.theme) &&
      (data.theme === 'light' || data.theme === 'dark') &&
      isString(data.language) &&
      isObject(data.sidebar) &&
      isBoolean(data.sidebar.isOpen) &&
      isNumber(data.sidebar.width) &&
      isArray(data.notifications, (item): item is Notification => notificationSchema.validate(item)) &&
      isObject(data.modals);
  }
};

// Loading State Schema
export const loadingStateSchema = {
  validate: (data: unknown): data is LoadingState => {
    return isObject(data) &&
      isBoolean(data.isLoading) &&
      (data.error === undefined || isString(data.error));
  }
};

// Combined State Validator
export const combinedStateValidator = {
  validate: (data: unknown): boolean => {
    return isObject(data) &&
      dashboardStateSchema.validate(data.dashboard) &&
      digestStateSchema.validate(data.digest) &&
      clientProfileStateSchema.validate(data.clientProfile) &&
      uiStateSchema.validate(data.ui);
  },

  safeParse: (data: unknown) => {
    if (combinedStateValidator.validate(data)) {
      return { success: true, data };
    }
    return { success: false, error: 'Invalid combined state data' };
  }
};

// Action Schema Validation
export const actionSchema = {
  validate: (data: unknown): data is { type: string; payload?: unknown; meta?: unknown } => {
    return isObject(data) &&
      isString(data.type) &&
      (data.payload === undefined || isObject(data.payload)) &&
      (data.meta === undefined || isObject(data.meta));
  }
};

// Form Validation Helpers
export const formValidation = {
  email: (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  },

  phone: (phone: string): boolean => {
    const phoneRegex = /^\+?[\d\s\-\(\)]+$/;
    return phoneRegex.test(phone);
  },

  url: (url: string): boolean => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  },

  required: (value: unknown): boolean => {
    return value !== undefined && value !== null && value !== '';
  }
};

// Error Handling Helpers
export const createValidationError = (field: string, message: string) => ({
  field,
  message,
  timestamp: new Date().toISOString()
});

export const isValidationError = (error: unknown): error is { field: string; message: string } => {
  return isObject(error) && isString(error.field) && isString(error.message);
};