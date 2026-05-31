// Core types for Recruiter Radar
export interface Entity {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface SoftDeleteEntity extends Entity {
  deletedAt?: string;
}

// Common API types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: {
    timestamp: string;
    requestId: string;
  };
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  orderBy?: {
    field: string;
    direction: 'ASC' | 'DESC';
  };
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// Common utility types
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;

// Common result types
export type Result<T, E = string> =
  | { success: true; data: T }
  | { success: false; error: E };

// Common error types
export interface AppError {
  code: string;
  message: string;
  details?: unknown;
}

export type AppErrorResult<T> = Result<T, AppError>;

// Common validation types
export interface ValidationRule<T> {
  required?: boolean;
  validator?: (value: unknown) => value is T;
  min?: number;
  max?: number;
  pattern?: RegExp;
  message?: string;
}

// Common action types
export interface BaseAction {
  type: string;
  payload?: unknown;
  error?: string;
  meta?: {
    timestamp: string;
    requestId?: string;
    data?: unknown;
  };
}

export interface BaseEnhancedAction extends BaseAction {
  meta?: {
    timestamp: string;
    requestId?: string;
    originalAction?: BaseAction;
    data?: unknown;
  };
}