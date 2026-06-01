// Typed Database Helper Functions
// Provides type-safe database operations using the db-types

import { getPool } from "./db";
import type {
  ClientProfile,
  Org,
  DigestItem,
  Lead,
  DigestRun,
  QueryOptions,
  PaginatedResult,
  DatabaseError
} from "./db-types";
import { Pool } from "pg";

// Validate input parameters to prevent SQL injection
// Note: value validation via regex has been removed — parameterized queries
// already protect against injection. The old regex blocked legitimate data
// like "O'Reilly" or "IT AND Telecom". Column names are validated separately
// via validateColumnName().
function validateInput(column: string, _value: unknown, operator: '=' | '>' | '<' | '>=' | '<=' | 'LIKE' | 'IN' | 'NOT IN' | '!=' | 'ILIKE'): void {
  if (typeof column !== 'string' || !column.trim()) {
    throw new Error('Column name must be a non-empty string');
  }

  // Validate operator
  const validOperators = ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'ILIKE', 'IN', 'NOT IN'];
  if (!validOperators.includes(operator)) {
    throw new Error(`Invalid operator: ${operator}`);
  }
}

// Validate column name against whitelist to prevent SQL injection via interpolation
function validateColumnName(name: string): void {
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('Column name must be a non-empty string');
  }
  // Only allow alphanumeric + underscore, must start with letter or underscore
  const columnNamePattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
  if (!columnNamePattern.test(name)) {
    throw new Error(`Invalid column name: ${name}`);
  }
}

// Validate order by clause
function validateOrderByClause(orderBy: Array<{ column: string; direction: 'ASC' | 'DESC' }>): void {
  for (const order of orderBy) {
    validateColumnName(order.column);
    if (order.direction !== 'ASC' && order.direction !== 'DESC') {
      throw new Error('Order direction must be either ASC or DESC');
    }
  }
}

// Generic query helper
export async function query<T>(
  text: string,
  params: unknown[] = [],
  options: QueryOptions = {}
): Promise<T[]> {
  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  // Ensure query text is a string
  if (typeof text !== 'string') {
    throw new Error('Query text must be a string');
  }

  try {
    const result = await pool.query<T>(text, params);
    return result.rows;
  } catch (error) {
    const dbError = error as DatabaseError;
    throw new Error(`Database query failed: ${dbError.message}`);
  }
}

// Get client profile by ID
export async function getClientProfileById(id: string): Promise<ClientProfile | null> {
  const results = await query<ClientProfile>(
    `SELECT id, name, industry, icp, daily_digest_limit, is_active, created_at, updated_at
     FROM client_profiles
     WHERE id = $1`,
    [id]
  );

  return results[0] || null;
}

// Get organization by ID
export async function getOrgById(id: number): Promise<Org | null> {
  const results = await query<Org>(
    `SELECT id, name, domain, website_url, created_at, updated_at
     FROM orgs
     WHERE id = $1`,
    [id]
  );

  return results[0] || null;
}

// Get digest run by ID
export async function getDigestRunById(id: string): Promise<DigestRun | null> {
  const results = await query<DigestRun>(
    `SELECT id, client_profile_id, source_key, status, requested_limit, selected_count, cooldown_days, created_at, completed_at
     FROM digest_runs
     WHERE id = $1`,
    [id]
  );

  return results[0] || null;
}

// Get digest items for a digest run
export async function getDigestItemsByDigestRunId(
  digestRunId: string,
  options: QueryOptions = {}
): Promise<DigestItem[]> {
  const { where, orderBy, limit = 100 } = options;

  let sql = `
    SELECT id, digest_run_id, rank, org_id, source_external_id, source_display_name,
           source_families, evidence_titles, candidate_source_keys, location_names,
           vacancies_count, distinct_vacancy_names_count, latest_published_at,
           total_score, reasons, opener, confidence_gate, created_at
    FROM digest_items
    WHERE digest_run_id = $1`;

  const params: unknown[] = [digestRunId];
  let paramIndex = 2;

  if (where && where.length > 0) {
    for (const condition of where) {
      validateColumnName(condition.column);
      validateInput(condition.column, condition.value, condition.operator);
      sql += ` AND ${condition.column} ${condition.operator} $${paramIndex}`;
      params.push(condition.value);
      paramIndex++;
    }
  }

  if (orderBy && orderBy.length > 0) {
    validateOrderByClause(orderBy);
    const orderByClause = orderBy.map(order =>
      `"${order.column}" ${order.direction}`
    ).join(', ');
    sql += ` ORDER BY ${orderByClause}`;
  }

  if (limit) {
    if (typeof limit !== 'number' || limit <= 0) {
      throw new Error('Limit must be a positive number');
    }
    sql += ` LIMIT ${limit}`;
  }

  return await query<DigestItem>(sql, params);
}

// Get leads for a client profile
export async function getLeadsByClientProfile(
  clientProfileId: string,
  options: QueryOptions = {}
): Promise<Lead[]> {
  const { where, orderBy, limit = 50 } = options;

  let sql = `
    SELECT id, client_profile_id, signal_id, state, score, feedback_status, created_at, updated_at, metadata
    FROM leads
    WHERE client_profile_id = $1`;

  const params: unknown[] = [clientProfileId];
  let paramIndex = 2;

  if (where && where.length > 0) {
    for (const condition of where) {
      validateColumnName(condition.column);
      validateInput(condition.column, condition.value, condition.operator);
      sql += ` AND ${condition.column} ${condition.operator} $${paramIndex}`;
      params.push(condition.value);
      paramIndex++;
    }
  }

  if (orderBy && orderBy.length > 0) {
    validateOrderByClause(orderBy);
    const orderByClause = orderBy.map(order =>
      `"${order.column}" ${order.direction}`
    ).join(', ');
    sql += ` ORDER BY ${orderByClause}`;
  }

  if (limit) {
    if (typeof limit !== 'number' || limit <= 0) {
      throw new Error('Limit must be a positive number');
    }
    sql += ` LIMIT ${limit}`;
  }

  return await query<Lead>(sql, params);
}

// Paginated query helper
export async function paginatedQuery<T>(
  text: string,
  params: unknown[],
  page: number = 1,
  pageSize: number = 20
): Promise<PaginatedResult<T>> {
  const offset = (page - 1) * pageSize;

  // Get total count
  const countText = text.replace(/SELECT\s+.*?\s+FROM/, 'SELECT COUNT(*) FROM');
  const countResult = await query<{ count: number }>(countText, params);
  const total = countResult[0]?.count || 0;

  // Get paginated data
  const paginatedText = `${text} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  const paginatedParams: unknown[] = [...params, pageSize, offset];

  const data = await query<T>(paginatedText, paginatedParams);

  return {
    data,
    total,
    page: Number(page),
    pageSize: Number(pageSize),
    totalPages: Math.ceil(Number(total) / Number(pageSize))
  };
}

// Transaction helper
export async function transaction<T>(callback: (client: any) => Promise<T>): Promise<T> {
  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Validate table name
function validateTableName(tableName: string): void {
  if (typeof tableName !== 'string' || !tableName.trim()) {
    throw new Error('Table name must be a non-empty string');
  }

  // Basic SQL injection detection for table names
  const tableNamePattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
  if (!tableNamePattern.test(tableName)) {
    throw new Error(`Invalid table name: ${tableName}`);
  }
}

// Batch insert helper
export async function batchInsert<T extends Record<string, unknown>>(
  tableName: string,
  data: T[],
  batchSize: number = 100
): Promise<void> {
  if (data.length === 0) return;

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  validateTableName(tableName);

  const fields = Object.keys(data[0]);
  if (fields.length === 0) {
    throw new Error('No fields to insert');
  }

  // Validate column names to prevent SQL injection
  for (const field of fields) {
    validateColumnName(field);
  }

  // Validate all items have the same structure
  for (const item of data) {
    const itemFields = Object.keys(item);
    if (itemFields.length !== fields.length) {
      throw new Error('All items must have the same structure');
    }
    for (const field of fields) {
      if (!(field in item)) {
        throw new Error(`Field ${field} missing in some items`);
      }
    }
  }

  const fieldCount = fields.length;

  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize);

    // Generate per-row placeholders: ($1,$2,$3), ($4,$5,$6), ...
    const rowPlaceholders = batch.map((_, rowIdx) => {
      const offset = rowIdx * fieldCount;
      const cols = fields.map((_, colIdx) => `$${offset + colIdx + 1}`);
      return `(${cols.join(', ')})`;
    }).join(', ');

    // Flatten values in order: [row1.val1, row1.val2, row2.val1, row2.val2, ...]
    const values = batch.flatMap((item: any) => fields.map(f => item[f]));

    await pool.query(
      `INSERT INTO ${tableName} (${fields.join(', ')}) VALUES ${rowPlaceholders}`,
      values
    );
  }
}