// Case conversion utilities for handling camelCase/snake_case compatibility
// Provides bidirectional conversion between naming conventions

// Type-safe case conversion utilities
export namespace CaseConverter {
  // Convert camelCase to snake_case
  export function camelToSnake(str: string): string {
    if (!str || typeof str !== 'string') return '';

    return str
      .replace(/([a-z])([A-Z])/g, '$1_$2')  // camelCase to snake_case
      .replace(/([A-Z])([A-Z])(?=[a-z])/g, '$1_$2')  // ABC to A_B
      .toLowerCase();
  }

  // Convert snake_case to camelCase
  export function snakeToCamel(str: string): string {
    if (!str || typeof str !== 'string') return '';

    return str
      .replace(/([-_][a-z])/g, (group) => group.toUpperCase().replace('-', '').replace('_', ''))
      .replace(/^./, (str) => str.toLowerCase());
  }

  // Convert PascalCase to snake_case
  export function pascalToSnake(str: string): string {
    if (!str || typeof str !== 'string') return '';

    return str
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .replace(/([A-Z])([A-Z])(?=[a-z])/g, '$1_$2')
      .toLowerCase();
  }

  // Convert snake_case to PascalCase
  export function snakeToPascal(str: string): string {
    if (!str || typeof str !== 'string') return '';

    return str
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  }

  // Convert string to title case
  export function toTitleCase(str: string): string {
    if (!str || typeof str !== 'string') return '';

    return str
      .split(/[_\s-]+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  // Convert string to kebab-case
  export function toKebabCase(str: string): string {
    if (!str || typeof str !== 'string') return '';

    return str
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .replace(/[\s_]+/g, '-')
      .toLowerCase();
  }
}

// Type-safe property name conversion
export interface PropertyMap {
  [key: string]: string;  // original -> converted
}

// Convert object keys from one case to another
export namespace ObjectConverter {
  // Convert object keys from camelCase to snake_case
  export function camelToSnakeKeys<T extends Record<string, any>>(obj: T): Record<string, any> {
    if (!obj || typeof obj !== 'object') return obj;

    const result: Record<string, any> = {};

    for (const [key, value] of Object.entries(obj)) {
      const snakeKey = CaseConverter.camelToSnake(key);

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[snakeKey] = ObjectConverter.camelToSnakeKeys(value);
      } else if (Array.isArray(value)) {
        result[snakeKey] = value.map(item =>
          item && typeof item === 'object' ? ObjectConverter.camelToSnakeKeys(item) : item
        );
      } else {
        result[snakeKey] = value;
      }
    }

    return result;
  }

  // Convert object keys from snake_case to camelCase
  export function snakeToCamelKeys<T extends Record<string, any>>(obj: T): Record<string, any> {
    if (!obj || typeof obj !== 'object') return obj;

    const result: Record<string, any> = {};

    for (const [key, value] of Object.entries(obj)) {
      const camelKey = CaseConverter.snakeToCamel(key);

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[camelKey] = ObjectConverter.snakeToCamelKeys(value);
      } else if (Array.isArray(value)) {
        result[camelKey] = value.map(item =>
          item && typeof item === 'object' ? ObjectConverter.snakeToCamelKeys(item) : item
        );
      } else {
        result[camelKey] = value;
      }
    }

    return result;
  }

  // Convert API response (snake_case) to app format (camelCase)
  export function apiToApp<T extends Record<string, any>>(data: T): Record<string, any> {
    return ObjectConverter.snakeToCamelKeys(data);
  }

  // Convert app format (camelCase) to API request (snake_case)
  export function appToApi<T extends Record<string, any>>(data: T): Record<string, any> {
    return ObjectConverter.camelToSnakeKeys(data);
  }
}

// Type-safe query parameter handling
export namespace QueryParamConverter {
  // Parse query params from URL (which are typically camelCase)
  export function parseQueryParams(url: string): Record<string, string> {
    const params: Record<string, string> = {};
    const urlSearchParams = new URLSearchParams(url.split('?')[1]);

    for (const [key, value] of urlSearchParams.entries()) {
      // Convert snake_case query params to camelCase
      params[CaseConverter.snakeToCamel(key)] = value;
    }

    return params;
  }

  // Convert query params object to URL string
  export function stringifyQueryParams(params: Record<string, string>): string {
    const snakeParams = ObjectConverter.camelToSnakeKeys(params);
    const urlSearchParams = new URLSearchParams();

    for (const [key, value] of Object.entries(snakeParams)) {
      urlSearchParams.append(key, value);
    }

    return urlSearchParams.toString();
  }
}

// Database column to property mapping
export interface DatabaseMapping {
  table: string;
  columns: {
    [column: string]: string;  // snake_case column -> camelCase property
  };
}

// Common database mappings for Recruiter Radar
export const DatabaseMappings: Record<string, DatabaseMapping> = {
  client_profiles: {
    table: 'client_profiles',
    columns: {
      id: 'id',
      created_at: 'createdAt',
      updated_at: 'updatedAt',
      org_id: 'orgId',
      company_name: 'companyName',
      industry: 'industry',
      location: 'location',
      icp_metrics: 'icpMetrics',
      is_active: 'isActive'
    }
  },
  digest_items: {
    table: 'digest_items',
    columns: {
      id: 'id',
      digest_run_id: 'digestRunId',
      org_id: 'orgId',
      company_name: 'companyName',
      company_url: 'companyUrl',
      primary_reason: 'primaryReason',
      secondary_reason: 'secondaryReason',
      confidence_score: 'confidenceScore',
      fiur_score: 'fiurScore'
    }
  }
};

// Utility to convert database rows to objects
export function databaseRowToObject<T>(
  tableName: string,
  row: Record<string, any>
): T | null {
  const mapping = DatabaseMappings[tableName];
  if (!mapping) return null;

  const result: Record<string, any> = {};

  for (const [column, property] of Object.entries(mapping.columns)) {
    if (row[column] !== undefined) {
      result[property] = row[column];
    }
  }

  return result as T;
}

// Convert object to database row
export function objectToDatabaseRow<T>(
  tableName: string,
  obj: T
): Record<string, any> {
  const mapping = DatabaseMappings[tableName];
  if (!mapping) return {};

  const result: Record<string, any> = {};

  for (const [column, property] of Object.entries(mapping.columns)) {
    if ((obj as any)[property] !== undefined) {
      result[column] = (obj as any)[property];
    }
  }

  return result;
}

// Type-safe query builder that handles case conversion
export class CaseAwareQueryBuilder {
  private tableName: string;
  private selectFields: string[] = [];
  private whereConditions: string[] = [];
  private orderByFields: string[] = [];

  constructor(tableName: string) {
    this.tableName = tableName;
  }

  // Add field selection (camelCase -> snake_case)
  select(field: string): this {
    this.selectFields.push(CaseConverter.camelToSnake(field));
    return this;
  }

  // Add where condition (camelCase property -> snake_case column)
  where(field: string, operator: string, value: any): this {
    const column = CaseConverter.camelToSnake(field);
    this.whereConditions.push(`${column} ${operator} ${this.formatValue(value)}`);
    return this;
  }

  // Add order by (camelCase property -> snake_case column)
  orderBy(field: string, direction: 'ASC' | 'DESC' = 'ASC'): this {
    const column = CaseConverter.camelToSnake(field);
    this.orderByFields.push(`${column} ${direction}`);
    return this;
  }

  // Build SQL query
  build(): string {
    let query = `SELECT ${this.selectFields.join(', ') || '*'} FROM ${this.tableName}`;

    if (this.whereConditions.length > 0) {
      query += ` WHERE ${this.whereConditions.join(' AND ')}`;
    }

    if (this.orderByFields.length > 0) {
      query += ` ORDER BY ${this.orderByFields.join(', ')}`;
    }

    return query;
  }

  private formatValue(value: any): string {
    if (typeof value === 'string') {
      return `'${value.replace(/'/g, "''")}'`;
    } else if (value instanceof Date) {
      return `'${value.toISOString()}'`;
    } else if (Array.isArray(value)) {
      return `(${value.map(v => this.formatValue(v)).join(', ')})`;
    } else {
      return value;
    }
  }
}

// Type-safe repository with case conversion
export class CaseAwareRepository<T> {
  private tableName: string;

  constructor(tableName: string) {
    this.tableName = tableName;
  }

  // Create query builder
  query(): CaseAwareQueryBuilder {
    return new CaseAwareQueryBuilder(this.tableName);
  }

  // Convert raw database results to typed objects
  mapResults(rows: Record<string, any>[]): T[] {
    const mapping = DatabaseMappings[this.tableName];
    if (!mapping) return [];

    return rows.map(row => {
      const obj: Record<string, any> = {};

      for (const [column, property] of Object.entries(mapping.columns)) {
        if (row[column] !== undefined) {
          obj[property] = row[column];
        }
      }

      return obj as T;
    });
  }
}

// Example usage:
/*
const repo = new CaseAwareRepository<ClientProfile>('client_profiles');
const query = repo.query()
  .select('companyName')
  .where('isActive', '=', true)
  .orderBy('createdAt', 'DESC');

const sql = query.build();
const results = repo.mapResults(databaseRows);
*/