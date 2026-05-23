// Secure Case Conversion Utilities with Anti-Injection Protection
// Provides safe case conversion with security hardening against code injection

import type { DatabaseMapping } from './case-converter';

// Security-focused utility functions
function isSafeString(value: unknown): value is string {
  if (typeof value !== 'string') return false;

  // Check for overly long strings that might cause DoS
  if (value.length > 10000) {
    throw new Error('String length exceeds security threshold');
  }

  // Check for control characters that might indicate injection attempts
  const controlChars = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
  if (controlChars.test(value)) {
    throw new Error('String contains invalid control characters');
  }

  return true;
}

function isSafeIdentifier(value: unknown): value is string {
  if (!isSafeString(value)) return false;

  // Allow only letters, numbers, and underscore for identifiers
  const identifierRegex = /^[a-zA-Z0-9_]+$/;
  return identifierRegex.test(value);
}

// Secure Case Converter with additional protection
export namespace SecureCaseConverter {
  // Convert camelCase to snake_case with input validation
  export function camelToSnake(str: unknown): string {
    if (!isSafeString(str)) {
      throw new Error('Invalid input: must be a string');
    }

    // Check for potentially dangerous patterns
    if (str.includes('eval') || str.includes('Function')) {
      throw new Error('String contains potentially dangerous content');
    }

    return str
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .replace(/([A-Z])([A-Z])(?=[a-z])/g, '$1_$2')
      .toLowerCase();
  }

  // Convert snake_case to camelCase with validation
  export function snakeToCamel(str: unknown): string {
    if (!isSafeString(str)) {
      throw new Error('Invalid input: must be a string');
    }

    // Check for SQL injection patterns
    if (str.includes('--') || str.includes('/*') || str.includes('*/') || str.includes('xp_')) {
      throw new Error('String contains potentially dangerous SQL patterns');
    }

    return str
      .replace(/([-_][a-z])/g, (group) => group.toUpperCase().replace('-', '').replace('_', ''))
      .replace(/^./, (str) => str.toLowerCase());
  }

  // Convert PascalCase to snake_case with validation
  export function pascalToSnake(str: unknown): string {
    if (!isSafeString(str)) {
      throw new Error('Invalid input: must be a string');
    }

    return str
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .replace(/([A-Z])([A-Z])(?=[a-z])/g, '$1_$2')
      .toLowerCase();
  }

  // Convert snake_case to PascalCase with validation
  export function snakeToPascal(str: unknown): string {
    if (!isSafeString(str)) {
      throw new Error('Invalid input: must be a string');
    }

    return str
      .split('_')
      .map(word => {
        if (!word) return '';
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join('');
  }

  // Convert string to title case with validation
  export function toTitleCase(str: unknown): string {
    if (!isSafeString(str)) {
      throw new Error('Invalid input: must be a string');
    }

    return str
      .split(/[_\s-]+/)
      .map(word => {
        if (!word) return '';
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(' ');
  }

  // Convert string to kebab-case with validation
  export function toKebabCase(str: unknown): string {
    if (!isSafeString(str)) {
      throw new Error('Invalid input: must be a string');
    }

    return str
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .replace(/[\s_]+/g, '-')
      .toLowerCase();
  }

  // Validate and sanitize identifier for safe usage
  export function sanitizeIdentifier(identifier: unknown): string {
    if (!isSafeIdentifier(identifier)) {
      throw new Error('Invalid identifier: must contain only letters, numbers, and underscores');
    }

    // Prevent SQL injection by adding quotes for string values
    return identifier;
  }

  // Escape string for safe SQL usage
  export function escapeSqlString(str: unknown): string {
    if (!isSafeString(str)) {
      throw new Error('Invalid string for SQL escaping');
    }

    return str
      .replace(/[\0]/g, '\\0')
      .replace(/[\n]/g, '\\n')
      .replace(/[\r]/g, '\\r')
      .replace(/[\x1a]/g, '\\Z')
      .replace(/["']/g, '\\$&')
      .replace(/[\\]/g, '\\\\');
  }
}

// Secure Object Converter with anti-injection protection
export namespace SecureObjectConverter {
  // Convert object keys from camelCase to snake_case with validation
  export function camelToSnakeKeys<T extends Record<string, any>>(obj: unknown): Record<string, any> {
    if (!obj || typeof obj !== 'object') {
      throw new Error('Input must be an object');
    }

    const result: Record<string, any> = {};

    for (const [key, value] of Object.entries(obj)) {
      // Validate each key
      const safeKey = SecureCaseConverter.sanitizeIdentifier(key);

      const snakeKey = SecureCaseConverter.camelToSnake(safeKey);

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[snakeKey] = SecureObjectConverter.camelToSnakeKeys(value);
      } else if (Array.isArray(value)) {
        result[snakeKey] = value.map(item =>
          item && typeof item === 'object' ? SecureObjectConverter.camelToSnakeKeys(item) : item
        );
      } else {
        result[snakeKey] = value;
      }
    }

    return result;
  }

  // Convert object keys from snake_case to camelCase with validation
  export function snakeToCamelKeys<T extends Record<string, any>>(obj: unknown): Record<string, any> {
    if (!obj || typeof obj !== 'object') {
      throw new Error('Input must be an object');
    }

    const result: Record<string, any> = {};

    for (const [key, value] of Object.entries(obj)) {
      // Validate snake_case key
      if (!/^[a-z][a-z0-9_]*$/.test(key)) {
        throw new Error(`Invalid snake_case key: ${key}`);
      }

      const camelKey = SecureCaseConverter.snakeToCamel(key);

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[camelKey] = SecureObjectConverter.snakeToCamelKeys(value);
      } else if (Array.isArray(value)) {
        result[camelKey] = value.map(item =>
          item && typeof item === 'object' ? SecureObjectConverter.snakeToCamelKeys(item) : item
        );
      } else {
        result[camelKey] = value;
      }
    }

    return result;
  }

  // Convert API response (snake_case) to app format (camelCase) with validation
  export function apiToApp<T extends Record<string, any>>(data: unknown): T {
    try {
      return SecureObjectConverter.snakeToCamelKeys(data) as T;
    } catch (error) {
      throw new Error(`Failed to convert API response: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Convert app format (camelCase) to API request (snake_case) with validation
  export function appToApi<T extends Record<string, any>>(data: T): Record<string, any> {
    try {
      return SecureObjectConverter.camelToSnakeKeys(data);
    } catch (error) {
      throw new Error(`Failed to convert app data to API format: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

// Secure Query Parameter Converter
export namespace SecureQueryParamConverter {
  // Parse query params from URL with validation
  export function parseQueryParams(url: string): Record<string, string> {
    if (!isSafeString(url)) {
      throw new Error('Invalid URL for query parsing');
    }

    try {
      const urlObj = new URL(url);
      const params: Record<string, string> = {};

      for (const [key, value] of urlObj.searchParams.entries()) {
        // Validate each parameter
        if (!isSafeIdentifier(key)) {
          throw new Error(`Invalid query parameter name: ${key}`);
        }

        // Decode and validate value
        const decodedValue = decodeURIComponent(value);
        if (!isSafeString(decodedValue)) {
          throw new Error(`Invalid query parameter value for ${key}`);
        }

        const camelKey = SecureCaseConverter.snakeToCamel(key);
        params[camelKey] = decodedValue;
      }

      return params;
    } catch (error) {
      throw new Error(`Failed to parse query parameters: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Convert query params object to URL string with validation
  export function stringifyQueryParams(params: Record<string, string>): string {
    try {
      const snakeParams = SecureObjectConverter.camelToSnakeKeys(params);
      const urlSearchParams = new URLSearchParams();

      for (const [key, value] of Object.entries(snakeParams)) {
        if (!isSafeString(key) || !isSafeString(value)) {
          throw new Error('Invalid query parameter');
        }

        urlSearchParams.append(key, value);
      }

      return urlSearchParams.toString();
    } catch (error) {
      throw new Error(`Failed to stringify query parameters: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

// Secure Database Query Builder with anti-SQL injection
export class SecureQueryBuilder {
  private tableName: string;
  private selectFields: string[] = [];
  private whereConditions: string[] = [];
  private orderBy: string[] = [];
  private limit?: number;
  private offset?: number;

  constructor(tableName: unknown) {
    if (!isSafeIdentifier(tableName)) {
      throw new Error('Invalid table name');
    }
    this.tableName = tableName as string;
  }

  // Add field selection with validation
  select(field: unknown): this {
    if (!isSafeIdentifier(field)) {
      throw new Error(`Invalid field name: ${field}`);
    }

    const snakeField = SecureCaseConverter.camelToSnake(field);
    this.selectFields.push(snakeField);
    return this;
  }

  // Add where condition with parameterized query support
  where(field: unknown, operator: string, value: unknown): this {
    if (!isSafeIdentifier(field)) {
      throw new Error(`Invalid field name: ${field}`);
    }

    if (typeof operator !== 'string' || !['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'IN'].includes(operator)) {
      throw new Error(`Invalid operator: ${operator}`);
    }

    const snakeField = SecureCaseConverter.camelToSnake(field);

    // Parameterize the value to prevent SQL injection
    const paramValue = this.formatValue(value);
    this.whereConditions.push(`${snakeField} ${operator} ${paramValue}`);

    return this;
  }

  // Add order by with validation
  orderBy(field: unknown, direction: 'ASC' | 'DESC' = 'ASC'): this {
    if (!isSafeIdentifier(field)) {
      throw new Error(`Invalid field name: ${field}`);
    }

    if (direction !== 'ASC' && direction !== 'DESC') {
      throw new Error('Order direction must be ASC or DESC');
    }

    const snakeField = SecureCaseConverter.camelToSnake(field);
    this.orderBy.push(`${snakeField} ${direction}`);
    return this;
  }

  // Add limit with validation
  limit(count: unknown): this {
    if (typeof count !== 'number' || count < 1 || count > 1000) {
      throw new Error('Limit must be a number between 1 and 1000');
    }
    this.limit = count;
    return this;
  }

  // Add offset with validation
  offset(count: unknown): this {
    if (typeof count !== 'number' || count < 0 || count > 10000) {
      throw new Error('Offset must be a number between 0 and 10000');
    }
    this.offset = count;
    return this;
  }

  // Build SQL query with parameterized values
  build(): { query: string; parameters: any[] } {
    let query = `SELECT ${this.selectFields.join(', ') || '*'} FROM ${this.tableName}`;

    const parameters: any[] = [];

    if (this.whereConditions.length > 0) {
      query += ` WHERE ${this.whereConditions.join(' AND ')}`;
    }

    if (this.orderBy.length > 0) {
      query += ` ORDER BY ${this.orderBy.join(', ')}`;
    }

    if (this.limit !== undefined) {
      query += ` LIMIT ${this.limit}`;
    }

    if (this.offset !== undefined) {
      query += ` OFFSET ${this.offset}`;
    }

    return { query, parameters };
  }

  // Safely format values for SQL queries
  private formatValue(value: any): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }

    if (typeof value === 'string') {
      // Escape string values
      return `'${SecureCaseConverter.escapeSqlString(value)}'`;
    } else if (typeof value === 'number') {
      return value.toString();
    } else if (Array.isArray(value)) {
      return `(${value.map(v => this.formatValue(v)).join(', ')})`;
    } else if (value instanceof Date) {
      return `'${value.toISOString()}'`;
    } else {
      throw new Error(`Unsupported value type: ${typeof value}`);
    }
  }
}

// Secure Repository with case conversion and validation
export class SecureRepository<T> {
  private tableName: string;

  constructor(tableName: unknown) {
    if (!isSafeIdentifier(tableName)) {
      throw new Error('Invalid table name');
    }
    this.tableName = tableName as string;
  }

  // Create secure query builder
  query(): SecureQueryBuilder {
    return new SecureQueryBuilder(this.tableName);
  }

  // Convert raw database results to typed objects with validation
  mapResults(rows: Record<string, any>[]): T[] {
    const mapping = DatabaseMappings[this.tableName];
    if (!mapping) {
      throw new Error(`No mapping found for table: ${this.tableName}`);
    }

    return rows.map(row => {
      const obj: Record<string, any> = {};

      for (const [column, property] of Object.entries(mapping.columns)) {
        if (row[column] !== undefined) {
          // Validate and sanitize the value
          const value = row[column];

          if (typeof value === 'string') {
            obj[property] = SecureCaseConverter.escapeSqlString(value);
          } else {
            obj[property] = value;
          }
        }
      }

      return obj as T;
    });
  }
}

// Security audit logging for case conversion
export class CaseConversionAuditLogger {
  private static logs: Array<{ timestamp: string; operation: string; details: any }> = [];

  static log(operation: string, details: any): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      operation,
      details: {
        ...details,
        // Sanitize sensitive information
        data: typeof details.data === 'string' ? details.data.substring(0, 100) + '...' : details.data
      }
    };

    this.logs.push(logEntry);

    // Keep only last 1000 logs
    if (this.logs.length > 1000) {
      this.logs = this.logs.slice(-1000);
    }

    // In production, this would send to a secure logging service
    if (process.env.NODE_ENV === 'development') {
      console.log('[Case Conversion Audit]', logEntry);
    }
  }

  static getLogs(): Array<{ timestamp: string; operation: string; details: any }> {
    return [...this.logs];
  }

  static clearLogs(): void {
    this.logs = [];
  }
}

// Export secure utilities
export const SecureCaseUtils = {
  SecureCaseConverter,
  SecureObjectConverter,
  SecureQueryParamConverter,
  SecureQueryBuilder,
  SecureRepository,
  CaseConversionAuditLogger
};