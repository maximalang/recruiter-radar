import React, { createContext, useContext, useReducer, useCallback, ReactNode } from 'react';
import type {
  AppContextType,
  DashboardState,
  DigestState,
  ClientProfileState,
  UIState,
  AsyncState,
  Notification,
  BaseAction,
  CombinedState,
  LoadingState,
  DigestRunOptions,
  ClientProfile
} from './state-management-types';

export type {
  DashboardState,
  DigestState,
  ClientProfileState,
  UIState,
  AsyncState,
  Notification,
  BaseAction,
  CombinedState,
  LoadingState,
  DigestRunOptions,
  ClientProfile
};
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
import { caseConversionMiddleware } from './case-conversion-middleware';

// Initial states
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

// Action types
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

// Action creators
const dashboardActions = {
  setOverview: (overview: DashboardState['overview']) => ({
    type: actionTypes.DASHBOARD.SET_OVERVIEW,
    payload: overview,
    meta: { timestamp: new Date().toISOString() }
  }),

  setSources: (sources: DashboardState['sources']) => ({
    type: actionTypes.DASHBOARD.SET_SOURCES,
    payload: sources,
    meta: { timestamp: new Date().toISOString() }
  }),

  setAlerts: (alerts: DashboardState['alerts']) => ({
    type: actionTypes.DASHBOARD.SET_ALERTS,
    payload: alerts,
    meta: { timestamp: new Date().toISOString() }
  }),

  setLoading: (loading: LoadingState) => ({
    type: actionTypes.DASHBOARD.SET_LOADING,
    payload: loading,
    meta: { timestamp: new Date().toISOString() }
  })
};

const uiActions = {
  toggleTheme: () => ({
    type: actionTypes.UI.TOGGLE_THEME,
    meta: { timestamp: new Date().toISOString() }
  }),

  showNotification: (notification: Notification) => ({
    type: actionTypes.UI.ADD_NOTIFICATION,
    payload: notification,
    meta: { timestamp: new Date().toISOString() }
  }),

  dismissNotification: (id: string) => ({
    type: actionTypes.UI.DISMISS_NOTIFICATION,
    payload: id,
    meta: { timestamp: new Date().toISOString() }
  })
};

// Reducers with validation
function dashboardReducer(state: DashboardState, action: BaseAction): DashboardState {
  switch (action.type) {
    case actionTypes.DASHBOARD.SET_OVERVIEW: {
      const overview = action.payload as DashboardState['overview'];
      if (!dashboardStateSchema.validate({ ...state, overview })) {
        console.error('Invalid dashboard state after SET_OVERVIEW');
        return state;
      }
      return { ...state, overview };
    }

    case actionTypes.DASHBOARD.SET_SOURCES: {
      const sources = action.payload as DashboardState['sources'];
      if (!Array.isArray(sources)) {
        console.error('Invalid sources payload');
        return state;
      }
      return { ...state, sources };
    }

    case actionTypes.DASHBOARD.SET_ALERTS: {
      const alerts = action.payload as DashboardState['alerts'];
      if (!Array.isArray(alerts)) {
        console.error('Invalid alerts payload');
        return state;
      }
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
}

function uiReducer(state: UIState, action: BaseAction): UIState {
  switch (action.type) {
    case actionTypes.UI.TOGGLE_THEME: {
      const newTheme = state.theme === 'light' ? 'dark' : 'light';
      if (newTheme !== 'light' && newTheme !== 'dark') {
        console.error('Invalid theme value:', newTheme);
        return state;
      }
      return { ...state, theme: newTheme };
    }

    case actionTypes.UI.ADD_NOTIFICATION: {
      const notification = action.payload as Notification;
      if (!notificationSchema.validate(notification)) {
        console.error('Invalid notification payload:', notification);
        return state;
      }
      const newNotifications = [...state.notifications, notification];
      if (!uiStateSchema.validate({ ...state, notifications: newNotifications })) {
        console.error('Invalid notifications array after adding');
        return state;
      }
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
}

// Combined reducer with validation
function rootReducer(state: CombinedState, action: BaseAction): CombinedState {
  // Validate action type
  if (typeof action.type !== 'string') {
    console.error('Invalid action type:', action);
    return state;
  }

  const newState = {
    dashboard: dashboardReducer(state.dashboard, action),
    digest: state.digest, // Placeholder
    clientProfile: state.clientProfile, // Placeholder
    ui: uiReducer(state.ui, action)
  };

  // Validate combined state after mutation
  const validationResult = combinedStateValidator.safeParse(newState);
  if (!validationResult.success) {
    console.error('State validation failed after action:', action.type, validationResult.error);
    // Optionally: dispatch error notification
  }

  return newState;
}

// Context
const AppContext = createContext<AppContextType | null>(null);

// Provider component
interface AppProviderProps {
  children: ReactNode;
  initialState?: Partial<CombinedState>;
}

export function AppProvider({ children, initialState = {} }: AppProviderProps) {
  const [state, dispatch] = useReducer(rootReducer, {
    dashboard: initialDashboardState,
    digest: initialDigestState,
    clientProfile: initialClientProfileState,
    ui: initialUIState,
    ...initialState
  });

  // Actions with error handling and validation
  const actions = {
    // Dashboard actions
    refreshDashboard: useCallback(async () => {
      if (state.dashboard.loading.isLoading) return;

      dispatch(dashboardActions.setLoading({ isLoading: true }));
      try {
        // TODO: Implement actual dashboard refresh
        // const data = await fetchDashboardData();
        // if (dashboardStateSchema.validate(data)) {
        //   dispatch(dashboardActions.setOverview(data.overview));
        //   dispatch(dashboardActions.setSources(data.sources));
        //   dispatch(dashboardActions.setAlerts(data.alerts));
        // } else {
        //   throw new Error('Invalid dashboard data received');
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
    }, [state.dashboard.loading.isLoading]),

    // UI actions
    toggleTheme: useCallback(() => {
      dispatch(uiActions.toggleTheme());
    }, []),

    showNotification: useCallback((notification: Notification) => {
      dispatch(uiActions.showNotification(notification));

      // Auto-dismiss after duration
      if (notification.duration && notification.duration > 0) {
        setTimeout(() => {
          dispatch(uiActions.dismissNotification(notification.id));
        }, notification.duration);
      }
    }, []),

    dismissNotification: useCallback((id: string) => {
      dispatch(uiActions.dismissNotification(id));
    }, []),

    openModal: useCallback((modalId: string, data?: unknown) => {
      dispatch({
        type: actionTypes.UI.OPEN_MODAL,
        payload: modalId,
        meta: { data, timestamp: new Date().toISOString() }
      });
    }, []),

    closeModal: useCallback((modalId: string) => {
      dispatch({
        type: actionTypes.UI.CLOSE_MODAL,
        payload: modalId,
        meta: { timestamp: new Date().toISOString() }
      });
    }, []),

    // Missing required actions
    updateSourceStatus: (sourceId: string, status: string) => {
      console.log('updateSourceStatus not implemented', { sourceId, status });
    },
    runDigest: async (options?: DigestRunOptions) => {
      console.log('runDigest not implemented', options);
    },
    cancelDigest: (runId: string) => {
      console.log('cancelDigest not implemented', runId);
    },
    switchProfile: async (profileId: string) => {
      console.log('switchProfile not implemented', profileId);
    },
    updateProfile: async (profileId: string, updates: Partial<ClientProfile>) => {
      console.log('updateProfile not implemented', { profileId, updates });
    }
  };

  const value: AppContextType = {
    dashboard: state.dashboard,
    digest: state.digest,
    clientProfile: state.clientProfile,
    ui: state.ui,
    actions
  };

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

// Hook
export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}

// Selectors
export const selectDashboardOverview = (state: CombinedState) => state.dashboard.overview;
export const selectDashboardSources = (state: CombinedState) => state.dashboard.sources;
export const selectDashboardAlerts = (state: CombinedState) => state.dashboard.alerts;
export const selectUITheme = (state: CombinedState) => state.ui.theme;
export const selectNotifications = (state: CombinedState) => state.ui.notifications;