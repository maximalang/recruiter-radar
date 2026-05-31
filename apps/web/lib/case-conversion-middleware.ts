// Middleware for automatic case conversion between API (snake_case) and frontend (camelCase)
import { Middleware, BaseAction, EnhancedMiddleware, MiddlewareAPI, Dispatch } from './state-management-types';
import { ObjectConverter, CaseConverter } from './case-converter';
import { createConditionalMiddleware } from './middleware/system';

// Enhanced Case Conversion Middleware
export const createCaseConversionMiddleware = (): EnhancedMiddleware => {
  return (store, next) => (action) => {
    const result = next(action);

    // Log the conversion
    if (typeof store.getState() === 'object' && (store.getState() as any).config?.enableLogging) {
      console.log('Case conversion middleware processed action:', action.type);
    }

    return result;
  };
};

// API Response Conversion Middleware
// Converts snake_case responses from API to camelCase for frontend
export const apiResponseConversionMiddleware: EnhancedMiddleware = (store, next) => (action) => {
  // Handle API responses (typically FULFILLED actions)
  if (typeof action.type === 'string' && action.type.includes('_FULFILLED')) {
    try {
      const convertedAction = {
        ...action,
        payload: ObjectConverter.apiToApp(action.payload as Record<string, any>)
      };

      if (typeof store.getState() === 'object' && (store.getState() as any).config?.enableLogging) {
        console.log('API response converted to camelCase:', action.type);
      }

      return next(convertedAction);
    } catch (error) {
      console.error('Case conversion error:', error);
      return next({
        ...action,
        error: 'Case conversion failed'
      });
    }
  }

  return next(action);
};

// API Request Conversion Middleware
// Converts camelCase actions to snake_case for API requests
export const apiRequestConversionMiddleware: EnhancedMiddleware = (store, next) => (action) => {
  // Handle API requests (typically async actions)
  if (
    typeof action.type === 'string' &&
    (
      action.type.includes('FETCH_') ||
      action.type.includes('CREATE_') ||
      action.type.includes('UPDATE_') ||
      action.type.includes('DELETE_')
    )
  ) {
    try {
      const convertedAction = {
        ...action,
        payload: action.payload ? ObjectConverter.appToApi(action.payload as Record<string, any>) : action.payload
      };

      if (typeof store.getState() === 'object' && (store.getState() as any).config?.enableLogging) {
        console.log('API request converted to snake_case:', action.type);
      }

      return next(convertedAction);
    } catch (error) {
      console.error('Case conversion error:', error);
      return next({
        ...action,
        error: 'Case conversion failed'
      });
    }
  }

  return next(action);
};

// Form Input Conversion Middleware
// Converts form inputs (camelCase) to snake_case for submission
export const formInputConversionMiddleware: EnhancedMiddleware = (store, next) => (action) => {
  if (typeof action.type === 'string' && action.type === 'FORM.SUBMIT') {
    try {
      const convertedAction = {
        ...action,
        payload: ObjectConverter.appToApi(action.payload as Record<string, any>)
      };

      if (typeof store.getState() === 'object' && (store.getState() as any).config?.enableLogging) {
        console.log('Form input converted to snake_case:', action.type);
      }

      return next(convertedAction);
    } catch (error) {
      console.error('Form conversion error:', error);
      return next({
        ...action,
        error: 'Form conversion failed'
      } as BaseAction);
    }
  }

  return next(action);
};

// Query Parameter Conversion Middleware
// Handles query parameter case conversion
export const queryParamConversionMiddleware: EnhancedMiddleware = (store, next) => (action) => {
  if (typeof action.type === 'string' && action.type === 'ROUTER.NAVIGATE') {
    try {
      const convertedParams = ObjectConverter.camelToSnakeKeys(action.payload?.query as Record<string, any>);

      const convertedAction = {
        ...action,
        payload: {
          ...action.payload,
          query: convertedParams
        }
      };

      if (typeof store.getState() === 'object' && (store.getState() as any).config?.enableLogging) {
        console.log('Query parameters converted to snake_case:', action.type);
      }

      return next(convertedAction);
    } catch (error) {
      console.error('Query parameter conversion error:', error);
      return next(action);
    }
  }

  return next(action);
};

// Composed middleware for case conversion
export const caseConversionMiddleware = [
  apiResponseConversionMiddleware,
  apiRequestConversionMiddleware,
  formInputConversionMiddleware,
  queryParamConversionMiddleware
];

// Logging middleware with case conversion (standalone)
export const loggingWithCaseConversionMiddleware: EnhancedMiddleware = (store, next) => (action) => {
  const result = next(action);

  if (typeof store.getState() === 'object' && (store.getState() as any).config?.enableLogging) {
    console.log('Action processed:', action.type);
  }

  return result;
};

// Type-safe action creators with case conversion
export const caseAwareActions = {
  // API Actions
  fetchApiData: (endpoint: string, params?: Record<string, unknown>) => ({
    type: 'FETCH_API_DATA',
    payload: params ? ObjectConverter.appToApi(params as Record<string, any>) : undefined,
    meta: { endpoint }
  }),

  // Form Actions
  submitForm: (formData: Record<string, unknown>) => ({
    type: 'FORM.SUBMIT',
    payload: ObjectConverter.appToApi(formData as Record<string, any>)
  }),

  // Update Actions
  updateProfile: (profile: Record<string, unknown>) => ({
    type: 'PROFILE.UPDATE',
    payload: ObjectConverter.appToApi(profile as Record<string, any>)
  })
};

// Utility: Create action that automatically converts payload
export function createCaseAwareAction(type: string, payload: unknown) {
  return {
    type,
    payload: payload ? ObjectConverter.appToApi(payload as Record<string, any>) : payload
  };
}

// Utility: Convert API response to app format
export function normalizeApiResponse<T>(response: unknown): T {
  return ObjectConverter.apiToApp(response as Record<string, any>) as T;
}

// Utility: Convert app data to API format
export function serializeForApi<T>(data: Record<string, unknown>): any {
  return ObjectConverter.appToApi(data);
}

// Example Usage in Components:
/*
// In API integration
const fetchDashboardData = async () => {
  const params = ObjectConverter.appToApi({
    companyId: '123',
    sortBy: 'updatedAt'
  });

  const response = await api.get('/dashboard', { params });
  return ObjectConverter.apiToApp(response.data);
};

// In form submission
const handleSubmit = (formData) => {
  const snakeCaseData = ObjectConverter.appToApi(formData);
  return api.post('/form', snakeCaseData);
};

// In state management
const actions = {
  updateCompany: (company: Company) => {
    const snakeCaseCompany = ObjectConverter.appToApi(company);
    dispatch({ type: 'COMPANY.UPDATE', payload: snakeCaseCompany });
  }
};
*/