// State Management Types for Recruiter Radar
// Provides type definitions for React state, Context API, and future state management solutions

// React State Types
export interface LoadingState {
  isLoading: boolean;
  error?: string;
  retryCount?: number;
}

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

// Export additional types for validation schemas
export interface DashboardOverview {
  totalSources: number;
  activeSources: number;
  overallHealth: number;
  totalAlerts: number;
  lastUpdated: string;
}

export interface DataSource {
  id: string;
  name: string;
  overall: number;
  lastRun: string;
  recordsProcessed: number;
  errors: number;
  status: 'excellent' | 'good' | 'warning' | 'critical';
}

export interface Alert {
  id: string;
  sourceId: string;
  message: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  timestamp: string;
  recommendations?: string[];
}

export interface DigestRun {
  id?: string;
  status: DigestRunStatus;
  progress: number;
  estimatedTime?: number;
}

export interface DigestHistoryItem {
  id: string;
  clientId: string;
  sourceKey: string;
  status: DigestRunStatus;
  itemsCount: number;
  createdAt: string;
  completedAt?: string;
}

export interface DigestSettings {
  autoRefresh: boolean;
  refreshInterval: number;
  maxItems: number;
  filters: {
    confidenceGates: ('A' | 'B' | 'C' | 'D')[];
    sources: string[];
  };
}

// Dashboard State Types
export interface DashboardState {
  overview: {
    totalSources: number;
    activeSources: number;
    overallHealth: number;
    totalAlerts: number;
    lastUpdated: string;
  };
  sources: Array<{
    id: string;
    name: string;
    overall: number;
    lastRun: string;
    recordsProcessed: number;
    errors: number;
    status: 'excellent' | 'good' | 'warning' | 'critical';
  }>;
  alerts: Array<{
    id: string;
    sourceId: string;
    message: string;
    severity: 'info' | 'warning' | 'error' | 'critical';
    timestamp: string;
    recommendations?: string[];
  }>;
  loading: LoadingState;
}

// Digest State Types
export type DigestRunStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';

export interface DigestState {
  currentRun: {
    id?: string;
    status: DigestRunStatus;
    progress: number;
    estimatedTime?: number;
  };
  history: Array<{
    id: string;
    clientId: string;
    sourceKey: string;
    status: DigestRunStatus;
    itemsCount: number;
    createdAt: string;
    completedAt?: string;
  }>;
  settings: {
    autoRefresh: boolean;
    refreshInterval: number;
    maxItems: number;
    filters: {
      confidenceGates: ('A' | 'B' | 'C' | 'D')[];
      sources: string[];
    };
  };
  loading: LoadingState;
}

// Client Profile Types
export interface ICPProfile {
  industries: string[];
  companySizes: ('startup' | 'small' | 'medium' | 'large' | 'enterprise')[];
  locations: string[];
  technologies: string[];
  keywords: string[];
  exclusions: string[];
}

export interface ClientProfile {
  id: string;
  name: string;
  industry?: string;
  dailyDigestLimit: number;
  isActive: boolean;
  icp: ICPProfile;
}

export interface DigestRunOptions {
  sourceKey?: string;
  maxItems?: number;
  forceRefresh?: boolean;
  confidenceGate?: 'A' | 'B' | 'C' | 'D';
}

// Client Profile State Types
export interface ClientProfileState {
  currentProfile: ClientProfile | null;
  profiles: Array<{
    id: string;
    name: string;
    industry?: string;
    isOwner: boolean;
    lastAccessed: string;
  }>;
  isEditing: boolean;
  loading: LoadingState;
}

// UI State Types
export interface UIState {
  theme: 'light' | 'dark';
  language: 'ru' | 'en';
  sidebar: {
    isOpen: boolean;
    width: number;
  };
  notifications: Notification[];
  modals: {
    [key: string]: {
      isOpen: boolean;
      data?: unknown;
    };
  };
}

// Context API Types
export interface AppContextType {
  dashboard: DashboardState;
  digest: DigestState;
  clientProfile: ClientProfileState;
  ui: UIState;
  actions: {
    // Dashboard actions
    refreshDashboard: () => Promise<void>;
    updateSourceStatus: (sourceId: string, status: string) => void;

    // Digest actions
    runDigest: (options?: DigestRunOptions) => Promise<void>;
    cancelDigest: (runId: string) => void;

    // Profile actions
    switchProfile: (profileId: string) => Promise<void>;
    updateProfile: (profileId: string, updates: Partial<ClientProfile>) => Promise<void>;

    // UI actions
    toggleTheme: () => void;
    showNotification: (notification: Notification) => void;
    dismissNotification: (id: string) => void;
    openModal: (modalId: string, data?: unknown) => void;
    closeModal: (modalId: string) => void;
  };
}

// Custom Hook Types
export interface UseAsyncOptions {
  immediate?: boolean;
  onSuccess?: (data: unknown) => void;
  onError?: (error: Error) => void;
}

export interface UseAsyncReturn<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  execute: (asyncFunction: () => Promise<T>) => Promise<void>;
  reset: () => void;
}

// Selector Types
export interface Selector<T> {
  (state: unknown): T;
}

// Notification Type
export interface Notification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number;
  actions?: Array<{
    label: string;
    action: string;
  }>;
}

// Action Types
export interface BaseAction {
  type: string;
  payload?: unknown;
  meta?: {
    timestamp: string;
    requestId?: string;
    data?: unknown;
  };
}

export interface AsyncAction extends BaseAction {
  meta: {
    timestamp: string;
    requestId: string;
    action: 'pending' | 'fulfilled' | 'rejected';
  };
  payload?: {
    data?: unknown;
    error?: Error;
  };
}

// Enhanced middleware types with configuration support
export interface EnhancedMiddleware<S = unknown> {
  (store: MiddlewareAPI<S>, next: Dispatch<S>): Dispatch<S>;
}

export interface MiddlewareAPI<S = unknown> {
  dispatch: Dispatch<S>;
  getState: () => S;
  config?: Record<string, any>;
}

export interface Middleware {
  (action: BaseAction, next: Dispatch): unknown;
}

export type Dispatch<S> = (action: BaseAction) => unknown;

// Enhanced action types
export interface BaseEnhancedAction extends BaseAction {
  timestamp?: string;
  error?: string;
  meta?: {
    timestamp?: string;
    originalAction?: BaseAction;
    data?: unknown;
  };
}

// Action types for enhanced middleware
export const ACTION_TYPES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  MIDDLEWARE_ERROR: 'MIDDLEWARE_ERROR',
  ASYNC_ACTION_STARTED: 'ASYNC_ACTION_STARTED',
  ASYNC_ACTION_FULFILLED: 'ASYNC_ACTION_FULFILLED',
  ASYNC_ACTION_REJECTED: 'ASYNC_ACTION_REJECTED'
} as const;

// Context Provider Props
export interface ProviderProps {
  children: React.ReactNode;
  initialState?: Partial<AppContextType>;
}

// Action Creators
export interface ActionCreators {
  [key: string]: (...args: unknown[]) => BaseAction;
}

// Reducer Types
export type Reducer<S = unknown, A extends BaseAction = BaseAction> = (
  state: S | undefined,
  action: A
) => S;

// Store Types
export interface Store<S> {
  dispatch: Dispatch<S>;
  getState: () => S;
  subscribe: (listener: () => void) => () => void;
  replaceReducer: (nextReducer: Reducer<S>) => void;
}

// Combined Reducer
export interface CombinedState {
  dashboard: DashboardState;
  digest: DigestState;
  clientProfile: ClientProfileState;
  ui: UIState;
}

// Note: Types are already exported above