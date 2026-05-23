// Secure App Context with Enhanced Security Measures
// Provides React Context API with additional security hardening

import React, { createContext, useContext, useReducer, useCallback, ReactNode, useEffect } from 'react';
import type {
  AppContextType,
  DashboardState,
  DigestState,
  ClientProfileState,
  UIState,
  AsyncState,
  Notification,
  BaseAction,
  CombinedState
} from './state-management-types';
import {
  dashboardStateSchema,
  digestStateSchema,
  clientProfileStateSchema,
  uiStateSchema,
  notificationSchema,
  combinedStateValidator,
  createValidationError,
  isString
} from './validation-schemas';
import {
  SecureCaseUtils,
  CaseConversionAuditLogger
} from './secure-case-converter';
import { SecurityUtils } from './secure-validation-schemas';

// Enhanced Initial States with Security Hardening
const initialDashboardState: DashboardState = {
  overview: {
    totalSources: 12,
    activeSources: 10,
    overallHealth: 85,
    totalAlerts: 2,
    lastUpdated: new Date().toISOString()
  },
  sources: [],
  alerts: [],
  loading: { isLoading: false }
};

const initialDigestState: DigestState = {
  currentRun: {
    status: 'idle',
    progress: 0
  },
  history: [],
  settings: {
    autoRefresh: false,
    refreshInterval: 30000,
    maxItems: 50,
    filters: {
      confidenceGates: ['A', 'B'],
      sources: []
    }
  },
  loading: { isLoading: false }
};

const initialClientProfileState: ClientProfileState = {
  currentProfile: null,
  profiles: [],
  isEditing: false,
  loading: { isLoading: false }
};

const initialUIState: UIState = {
  theme: 'light',
  language: 'ru',
  sidebar: {
    isOpen: true,
    width: 280
  },
  notifications: [],
  modals: {}
};

// Secure Action Types with Validation
const actionTypes = {
  DASHBOARD: {
    SET_OVERVIEW: 'DASHBOARD.SET_OVERVIEW',
    SET_SOURCES: 'DASHBOARD.SET_SOURCES',
    SET_ALERTS: 'DASHBOARD.SET_ALERTS',
    SET_LOADING: 'DASHBOARD.SET_LOADING',
    RESET_LOADING: 'DASHBOARD.RESET_LOADING'
  },
  DIGEST: {
    SET_CURRENT_RUN: 'DIGEST.SET_CURRENT_RUN',
    ADD_HISTORY: 'DIGEST.ADD_HISTORY',
    SET_SETTINGS: 'DIGEST.SET_SETTINGS',
    SET_LOADING: 'DIGEST.SET_LOADING'
  },
  CLIENT_PROFILE: {
    SET_CURRENT_PROFILE: 'CLIENT_PROFILE.SET_CURRENT_PROFILE',
    SET_PROFILES: 'CLIENT_PROFILE.SET_PROFILES',
    SET_EDITING: 'CLIENT_PROFILE.SET_EDITING',
    SET_LOADING: 'CLIENT_PROFILE.SET_LOADING'
  },
  UI: {
    TOGGLE_THEME: 'UI.TOGGLE_THEME',
    SET_LANGUAGE: 'UI.SET_LANGUAGE',
    TOGGLE_SIDEBAR: 'UI.TOGGLE_SIDEBAR',
    ADD_NOTIFICATION: 'UI.ADD_NOTIFICATION',
    DISMISS_NOTIFICATION: 'UI.DISMISS_NOTIFICATION',
    OPEN_MODAL: 'UI.OPEN_MODAL',
    CLOSE_MODAL: 'UI.CLOSE_MODAL'
  }
};

// Secure Action Creators with Validation
const createSecureAction = (type: string, payload?: any, meta?: any) => {
  // Validate action structure
  if (!isString(type)) {
    throw new Error('Action type must be a string');
  }

  // Sanitize payload if provided
  if (payload !== undefined) {
    if (typeof payload === 'object') {
      payload = SecurityUtils.sanitizeObjectKeys(payload);
    }
  }

  // Sanitize meta if provided
  if (meta !== undefined) {
    if (typeof meta === 'object') {
      meta = SecurityUtils.sanitizeObjectKeys(meta);
    }
  }

  return {
    type,
    payload,
    meta: {
      ...meta,
      timestamp: new Date().toISOString(),
      source: 'secure-app-context'
    }
  };
};

const dashboardActions = {
  setOverview: (overview: DashboardState['overview']) => {
    if (!dashboardStateSchema.validate({ overview })) {
      throw new Error('Invalid dashboard overview data');
    }
    return createSecureAction(actionTypes.DASHBOARD.SET_OVERVIEW, overview);
  },

  setSources: (sources: DashboardState['sources']) => {
    if (!Array.isArray(sources)) {
      throw new Error('Sources must be an array');
    }
    if (sources.length > 1000) {
      throw new Error('Sources array too large');
    }
    return createSecureAction(actionTypes.DASHBOARD.SET_SOURCES, sources);
  },

  setAlerts: (alerts: DashboardState['alerts']) => {
    if (!Array.isArray(alerts)) {
      throw new Error('Alerts must be an array');
    }
    if (alerts.length > 1000) {
      throw new Error('Alerts array too large');
    }
    return createSecureAction(actionTypes.DASHBOARD.SET_ALERTS, alerts);
  },

  setLoading: (loading: LoadingState) => {
    if (!loading || typeof loading !== 'object') {
      throw new Error('Loading state must be an object');
    }
    return createSecureAction(actionTypes.DASHBOARD.SET_LOADING, loading);
  }
};

const uiActions = {
  toggleTheme: () => {
    return createSecureAction(actionTypes.UI.TOGGLE_THEME);
  },

  showNotification: (notification: Notification) => {
    // Validate notification
    if (!notificationSchema.validate(notification)) {
      throw new Error('Invalid notification data');
    }

    // Sanitize message to prevent XSS
    const sanitizedNotification = {
      ...notification,
      message: SecurityUtils.secureFormValidation.preventXSS(notification.message)
    };

    return createSecureAction(actionTypes.UI.ADD_NOTIFICATION, sanitizedNotification);
  },

  dismissNotification: (id: string) => {
    if (!isString(id)) {
      throw new Error('Notification ID must be a string');
    }
    return createSecureAction(actionTypes.UI.DISMISS_NOTIFICATION, id);
  }
};

// Secure Reducers with Input Validation
function secureDashboardReducer(state: DashboardState, action: BaseAction): DashboardState {
  try {
    // Validate action type
    if (!isString(action.type)) {
      return state;
    }

    switch (action.type) {
      case actionTypes.DASHBOARD.SET_OVERVIEW: {
        const overview = action.payload as DashboardState['overview'];
        if (!dashboardStateSchema.validate({ ...state, overview })) {
          console.error('Invalid dashboard state after SET_OVERVIEW');
          return state;
        }
        CaseConversionAuditLogger.log('DASHBOARD.SET_OVERVIEW', { overview });
        return { ...state, overview };
      }

      case actionTypes.DASHBOARD.SET_SOURCES: {
        const sources = action.payload as DashboardState['sources'];
        if (!Array.isArray(sources) || sources.length > 1000) {
          console.error('Invalid sources payload');
          return state;
        }
        CaseConversionAuditLogger.log('DASHBOARD.SET_SOURCES', { count: sources.length });
        return { ...state, sources };
      }

      case actionTypes.DASHBOARD.SET_ALERTS: {
        const alerts = action.payload as DashboardState['alerts'];
        if (!Array.isArray(alerts) || alerts.length > 1000) {
          console.error('Invalid alerts payload');
          return state;
        }
        CaseConversionAuditLogger.log('DASHBOARD.SET_ALERTS', { count: alerts.length });
        return { ...state, alerts };
      }

      case actionTypes.DASHBOARD.SET_LOADING: {
        const loading = action.payload as LoadingState;
        if (!loading || typeof loading !== 'object' || typeof loading.isLoading !== 'boolean') {
          console.error('Invalid loading state');
          return state;
        }
        return { ...state, loading };
      }

      default:
        return state;
    }
  } catch (error) {
    console.error('Dashboard reducer error:', error);
    return state;
  }
}

function secureUIReducer(state: UIState, action: BaseAction): UIState {
  try {
    // Validate action type
    if (!isString(action.type)) {
      return state;
    }

    switch (action.type) {
      case actionTypes.UI.TOGGLE_THEME: {
        const newTheme = state.theme === 'light' ? 'dark' : 'light';
        if (newTheme !== 'light' && newTheme !== 'dark') {
          console.error('Invalid theme value:', newTheme);
          return state;
        }
        CaseConversionAuditLogger.log('UI.TOGGLE_THEME', { theme: newTheme });
        return { ...state, theme: newTheme };
      }

      case actionTypes.UI.ADD_NOTIFICATION: {
        const notification = action.payload as Notification;
        if (!notificationSchema.validate(notification)) {
          console.error('Invalid notification payload:', notification);
          return state;
        }

        const sanitizedNotification = {
          ...notification,
          message: SecurityUtils.secureFormValidation.preventXSS(notification.message)
        };

        const newNotifications = [...state.notifications, sanitizedNotification];
        if (!uiStateSchema.validate({ ...state, notifications: newNotifications })) {
          console.error('Invalid notifications array after adding');
          return state;
        }

        CaseConversionAuditLogger.log('UI.ADD_NOTIFICATION', {
          id: notification.id,
          type: notification.type
        });

        return { ...state, notifications: newNotifications };
      }

      case actionTypes.UI.DISMISS_NOTIFICATION: {
        const id = action.payload as string;
        if (!isString(id)) {
          console.error('Invalid notification id');
          return state;
        }
        const newNotifications = state.notifications.filter(n => n.id !== id);
        if (!uiStateSchema.validate({ ...state, notifications: newNotifications })) {
          console.error('Invalid notifications array after dismissal');
          return state;
        }
        CaseConversionAuditLogger.log('UI.DISMISS_NOTIFICATION', { id });
        return { ...state, notifications: newNotifications };
      }

      case actionTypes.UI.OPEN_MODAL: {
        const modalId = action.payload as string;
        if (!isString(modalId)) {
          console.error('Invalid modal id');
          return state;
        }
        return {
          ...state,
          modals: {
            ...state.modals,
            [modalId]: { isOpen: true, data: action.meta?.data }
          }
        };
      }

      case actionTypes.UI.CLOSE_MODAL: {
        const modalId = action.payload as string;
        if (!isString(modalId)) {
          console.error('Invalid modal id');
          return state;
        }
        const { [modalId]: _, ...rest } = state.modals;
        return { ...state, modals: rest };
      }

      default:
        return state;
    }
  } catch (error) {
    console.error('UI reducer error:', error);
    return state;
  }
}

// Secure Combined Reducer
function secureRootReducer(state: CombinedState, action: BaseAction): CombinedState {
  // Validate action type
  if (!isString(action.type)) {
    console.error('Invalid action type:', action);
    return state;
  }

  try {
    const newState = {
      dashboard: secureDashboardReducer(state.dashboard, action),
      digest: state.digest, // Placeholder
      clientProfile: state.clientProfile, // Placeholder
      ui: secureUIReducer(state.ui, action)
    };

    // Validate combined state after mutation
    const validationResult = combinedStateValidator.safeParse(newState);
    if (!validationResult.success) {
      console.error('State validation failed after action:', action.type, validationResult.error);
      return state;
    }

    // Log state changes for audit
    CaseConversionAuditLogger.log('STATE_MUTATION', {
      type: action.type,
      timestamp: new Date().toISOString()
    });

    return newState;
  } catch (error) {
    console.error('Root reducer error:', error);
    return state;
  }
}

// Security Context
const AppSecurityContext = createContext<{
  rateLimitExceeded: boolean;
  lastActionTime: number;
  actionCount: number;
}>({
  rateLimitExceeded: false,
  lastActionTime: 0,
  actionCount: 0
});

// Enhanced Context with Security Measures
const AppContext = createContext<AppContextType | null>(null);

// Enhanced Provider Component
interface SecureAppProviderProps {
  children: ReactNode;
  initialState?: Partial<CombinedState>;
  maxActionsPerMinute?: number;
}

export function SecureAppProvider({
  children,
  initialState = {},
  maxActionsPerMinute = 60
}: SecureAppProviderProps) {
  const [state, dispatch] = useReducer(secureRootReducer, {
    dashboard: initialDashboardState,
    digest: initialDigestState,
    clientProfile: initialClientProfileState,
    ui: initialUIState,
    ...initialState
  });

  // Rate limiting state
  const [securityState, setSecurityState] = useState({
    rateLimitExceeded: false,
    lastActionTime: 0,
    actionCount: 0
  });

  // Action rate limiting
  const checkRateLimit = useCallback((actionType: string) => {
    const now = Date.now();
    const timeWindow = 60 * 1000; // 1 minute

    // Reset counter if window has passed
    if (now - securityState.lastActionTime > timeWindow) {
      setSecurityState(prev => ({
        ...prev,
        actionCount: 1,
        lastActionTime: now
      }));
      return true;
    }

    // Check if limit exceeded
    if (securityState.actionCount >= maxActionsPerMinute) {
      setSecurityState(prev => ({
        ...prev,
        rateLimitExceeded: true
      }));
      console.warn(`Rate limit exceeded for action: ${actionType}`);
      return false;
    }

    // Increment counter
    setSecurityState(prev => ({
      ...prev,
      actionCount: prev.actionCount + 1,
      lastActionTime: now
    }));
    return true;
  }, [securityState.actionCount, maxActionsPerMinute]);

  // Enhanced Actions with Security
  const actions = {
    // Dashboard actions with rate limiting
    refreshDashboard: useCallback(async () => {
      if (!checkRateLimit('refreshDashboard')) return;

      dispatch(dashboardActions.setLoading({ isLoading: true }));
      try {
        // TODO: Implement actual dashboard refresh
        // const data = await fetchDashboardData();
        // if (dashboardStateSchema.validate(data)) {
        //   dispatch(dashboardActions.setOverview(data.overview));
        //   dispatch(dashboardActions.setSources(data.sources));
        //   dispatch(dashboardActions.setAlerts(data.alerts));
        // }
      } catch (error) {
        console.error('Dashboard refresh failed:', error);
        dispatch(dashboardActions.setLoading({
          isLoading: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        }));
      } finally {
        dispatch(dashboardActions.setLoading({ isLoading: false }));
      }
    }, [checkRateLimit]),

    // Enhanced UI actions with security
    toggleTheme: useCallback(() => {
      if (!checkRateLimit('toggleTheme')) return;

      try {
        dispatch(uiActions.toggleTheme());
      } catch (error) {
        console.error('Theme toggle failed:', error);
      }
    }, [checkRateLimit]),

    showNotification: useCallback((notification: Notification) => {
      if (!checkRateLimit('showNotification')) return;

      try {
        // Validate notification before dispatching
        if (!notificationSchema.validate(notification)) {
          throw new Error('Invalid notification data');
        }

        // Sanitize message
        const sanitizedNotification = {
          ...notification,
          message: SecurityUtils.secureFormValidation.preventXSS(notification.message)
        };

        dispatch(uiActions.showNotification(sanitizedNotification));

        // Auto-dismiss after duration
        if (sanitizedNotification.duration && sanitizedNotification.duration > 0) {
          setTimeout(() => {
            dispatch(uiActions.dismissNotification(sanitizedNotification.id));
          }, sanitizedNotification.duration);
        }
      } catch (error) {
        console.error('Notification display failed:', error);
      }
    }, [checkRateLimit]),

    dismissNotification: useCallback((id: string) => {
      if (!checkRateLimit('dismissNotification')) return;

      try {
        if (!isString(id)) {
          throw new Error('Invalid notification ID');
        }
        dispatch(uiActions.dismissNotification(id));
      } catch (error) {
        console.error('Notification dismissal failed:', error);
      }
    }, [checkRateLimit]),

    openModal: useCallback((modalId: string, data?: unknown) => {
      if (!checkRateLimit('openModal')) return;

      try {
        if (!isString(modalId)) {
          throw new Error('Invalid modal ID');
        }

        // Sanitize modal data
        const sanitizedData = data ? SecurityUtils.sanitizeObjectKeys(data) : undefined;

        dispatch({
          type: actionTypes.UI.OPEN_MODAL,
          payload: modalId,
          meta: { data: sanitizedData, timestamp: new Date().toISOString() }
        });
      } catch (error) {
        console.error('Modal opening failed:', error);
      }
    }, [checkRateLimit]),

    closeModal: useCallback((modalId: string) => {
      if (!checkRateLimit('closeModal')) return;

      try {
        if (!isString(modalId)) {
          throw new Error('Invalid modal ID');
        }
        dispatch({
          type: actionTypes.UI.CLOSE_MODAL,
          payload: modalId,
          meta: { timestamp: new Date().toISOString() }
        });
      } catch (error) {
        console.error('Modal closing failed:', error);
      }
    }, [checkRateLimit])
  };

  // Security audit logging for state changes
  useEffect(() => {
    // Log state changes periodically
    const interval = setInterval(() => {
      if (state.ui.notifications.length > 0) {
        CaseConversionAuditLogger.log('STATE_SNAPSHOT', {
          notifications: state.ui.notifications.length,
          theme: state.ui.theme
        });
      }
    }, 30000); // Every 30 seconds

    return () => clearInterval(interval);
  }, [state]);

  const value: AppContextType = {
    dashboard: state.dashboard,
    digest: state.digest,
    clientProfile: state.clientProfile,
    ui: state.ui,
    actions,
    security: {
      rateLimitExceeded: securityState.rateLimitExceeded,
      lastActionTime: securityState.lastActionTime,
      maxActionsPerMinute
    }
  };

  return (
    <AppContext.Provider value={value}>
      <AppSecurityContext.Provider value={securityState}>
        {children}
      </AppSecurityContext.Provider>
    </AppContext.Provider>
  );
}

// Enhanced Hook with Security Context
export function useSecureAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useSecureAppContext must be used within a SecureAppProvider');
  }
  return context;
}

// Security Context Hook
export function useSecurityContext() {
  const context = useContext(AppSecurityContext);
  if (!context) {
    throw new Error('useSecurityContext must be used within a SecureAppProvider');
  }
  return context;
}

// Security-aware Selectors
export const secureSelectDashboardOverview = (state: CombinedState) => {
  if (!dashboardStateSchema.validate({ dashboard: state.dashboard })) {
    throw new Error('Invalid dashboard state');
  }
  return state.dashboard.overview;
};

export const secureSelectDashboardSources = (state: CombinedState) => {
  if (!Array.isArray(state.dashboard.sources)) {
    throw new Error('Invalid sources state');
  }
  return state.dashboard.sources;
};

export const secureSelectDashboardAlerts = (state: CombinedState) => {
  if (!Array.isArray(state.dashboard.alerts)) {
    throw new Error('Invalid alerts state');
  }
  return state.dashboard.alerts;
};

export const secureSelectUITheme = (state: CombinedState) => {
  if (state.ui.theme !== 'light' && state.ui.theme !== 'dark') {
    throw new Error('Invalid theme state');
  }
  return state.ui.theme;
};

export const secureSelectNotifications = (state: CombinedState) => {
  if (!Array.isArray(state.ui.notifications)) {
    throw new Error('Invalid notifications state');
  }
  // Sanitize messages to prevent XSS
  return state.ui.notifications.map(notification => ({
    ...notification,
    message: SecurityUtils.secureFormValidation.preventXSS(notification.message)
  }));
};