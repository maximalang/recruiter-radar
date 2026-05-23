// Validation schemas - deprecated, use validation-system.ts instead
// This file is kept for backward compatibility only

// Import everything from the unified validation system
export * from './validation/validation-system';

// Legacy schemas for backward compatibility
export const dashboardStateSchema = {
  validate: (data: unknown): data is {
    totalSources: number;
    activeSources: number;
    overallHealth: number;
    totalAlerts: number;
    lastUpdated: string;
  } => {
    return isObject(data) &&
      isNumber(data.totalSources) &&
      isNumber(data.activeSources) &&
      isNumber(data.overallHealth) &&
      isNumber(data.totalAlerts) &&
      isDateString(data.lastUpdated);
  }
};

export const digestStateSchema = {
  validate: (data: unknown): data is {
    status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';
    progress: number;
    estimatedTime?: number;
  } => {
    return isObject(data) &&
      typeof data.status === 'string' &&
      isNumber(data.progress) &&
      (data.estimatedTime === undefined || isNumber(data.estimatedTime));
  }
};

export const clientProfileStateSchema = {
  validate: (data: unknown): data is {
    id: string;
    name: string;
    industry?: string;
    dailyDigestLimit: number;
    isActive: boolean;
    icp: {
      industries: string[];
      companySizes: ('startup' | 'small' | 'medium' | 'large' | 'enterprise')[];
      locations: string[];
      technologies: string[];
      keywords: string[];
      exclusions: string[];
    };
  } => {
    return isObject(data) &&
      isString(data.id) &&
      isString(data.name) &&
      (data.industry === undefined || isString(data.industry)) &&
      isNumber(data.dailyDigestLimit) &&
      isBoolean(data.isActive) &&
      isObject(data.icp) &&
      Array.isArray(data.icp.industries) &&
      Array.isArray(data.icp.companySizes) &&
      Array.isArray(data.icp.locations) &&
      Array.isArray(data.icp.technologies) &&
      Array.isArray(data.icp.keywords) &&
      Array.isArray(data.icp.exclusions);
  }
};

export const uiStateSchema = {
  validate: (data: unknown): data is {
    theme: 'light' | 'dark';
    language: 'ru' | 'en';
    sidebar: {
      isOpen: boolean;
      width: number;
    };
    notifications: Array<{
      id: string;
      type: 'success' | 'error' | 'warning' | 'info';
      message: string;
      duration?: number;
    }>;
  } => {
    return isObject(data) &&
      typeof data.theme === 'string' &&
      typeof data.language === 'string' &&
      isObject(data.sidebar) &&
      typeof data.sidebar.isOpen === 'boolean' &&
      isNumber(data.sidebar.width) &&
      Array.isArray(data.notifications);
  }
};

export const notificationSchema = {
  validate: (data: unknown): data is {
    id: string;
    type: 'success' | 'error' | 'warning' | 'info';
    message: string;
    duration?: number;
  } => {
    return isObject(data) &&
      isString(data.id) &&
      typeof data.type === 'string' &&
      isString(data.message) &&
      (data.duration === undefined || isNumber(data.duration));
  }
};

// Import utility functions from validation system
import { isObject, isString, isNumber, isBoolean, isDateString } from './validation/validation-system';

// Combined state validator
export const combinedStateValidator = (state: unknown): boolean => {
  return isObject(state) &&
    dashboardStateSchema.validate(state.dashboard) &&
    digestStateSchema.validate(state.digest) &&
    clientProfileStateSchema.validate(state.clientProfile) &&
    uiStateSchema.validate(state.ui);
};