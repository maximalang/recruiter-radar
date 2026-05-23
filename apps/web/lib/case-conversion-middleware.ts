// Middleware for automatic case conversion between API (snake_case) and frontend (camelCase)
import { Middleware, BaseAction } from './state-management-types';
import { ObjectConverter, CaseConverter } from './case-converter';

// API Response Conversion Middleware
// Converts snake_case responses from API to camelCase for frontend
export const apiResponseConversionMiddleware: Middleware = (action, next) => {
  // Handle API responses (typically FULFILLED actions)
  if (action.type.includes('_FULFILLED')) {
    const convertedAction = {
      ...action,
      payload: ObjectConverter.apiToApp(action.payload)
    };

    return next(convertedAction);
  }

  return next(action);
};

// API Request Conversion Middleware
// Converts camelCase actions to snake_case for API requests
export const apiRequestConversionMiddleware: Middleware = (action, next) => {
  // Handle API requests (typically async actions)
  if (
    action.type.includes('FETCH_') ||
    action.type.includes('CREATE_') ||
    action.type.includes('UPDATE_') ||
    action.type.includes('DELETE_')
  ) {
    const convertedAction = {
      ...action,
      payload: action.payload ? ObjectConverter.appToApi(action.payload) : action.payload
    };

    return next(convertedAction);
  }

  return next(action);
};

// Form Input Conversion Middleware
// Converts form inputs (camelCase) to snake_case for submission
export const formInputConversionMiddleware: Middleware = (action, next) => {
  if (action.type === 'FORM.SUBMIT') {
    const convertedAction = {
      ...action,
      payload: ObjectConverter.appToApi(action.payload)
    };

    return next(convertedAction);
  }

  return next(action);
};

// Query Parameter Conversion Middleware
// Handles query parameter case conversion
export const queryParamConversionMiddleware: Middleware = (store: any) => (next: any) => (action: BaseAction) => {
  if (action.type === 'ROUTER.NAVIGATE') {
    const convertedParams = ObjectConverter.camelToSnakeKeys(action.payload?.query);

    const convertedAction = {
      ...action,
      payload: {
        ...action.payload,
        query: convertedParams
      }
    };

    return next(convertedAction);
  }

  return next(action);
};

// Logging Middleware with Case Conversion
// Logs actions in consistent case format
export const loggingWithCaseConversionMiddleware: Middleware = (store: any) => (next: any) => (action: BaseAction) => {
  const result = next(action);
  return result;
};

// Composed middleware for case conversion
export const caseConversionMiddleware = [
  apiResponseConversionMiddleware,
  apiRequestConversionMiddleware,
  formInputConversionMiddleware,
  queryParamConversionMiddleware,
  loggingWithCaseConversionMiddleware
];

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