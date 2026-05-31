/**
 * Tests for typed-db.ts — T1.1 (shadow fix), T1.2 (batchInsert), T1.4 (column whitelist)
 *
 * We mock the pg Pool so no real DB is needed.
 */

// ---- Mock getPool ----
const mockQuery = jest.fn()
jest.mock('@/lib/db', () => ({
  getPool: () => ({
    query: mockQuery,
    connect: () => ({
      query: mockQuery,
      release: jest.fn(),
    }),
  }),
}))

// Import after mock setup
import { batchInsert, query } from '@/lib/typed-db'

beforeEach(() => {
  mockQuery.mockReset()
})

// ============================================================
// T1.1 — Shadow variable fix (query→sql)
// ============================================================
describe('T1.1: query function is callable (shadow variable fix)', () => {
  it('query<T> returns rows from pool.query', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '1', name: 'test' }] })
    const result = await query<{ id: string; name: string }>('SELECT * FROM test WHERE id = $1', ['1'])
    expect(result).toEqual([{ id: '1', name: 'test' }])
    expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM test WHERE id = $1', ['1'])
  })

  it('query<T> throws if pool is null', async () => {
    // Re-mock getPool to return null once
    jest.resetModules()
    jest.doMock('@/lib/db', () => ({ getPool: () => null }))
    const { query: queryNull } = await import('@/lib/typed-db')
    await expect(queryNull('SELECT 1')).rejects.toThrow('DATABASE_URL is not set')
    jest.resetModules()
    jest.doMock('@/lib/db', () => ({ getPool: () => ({ query: mockQuery }) }))
  })
})

// ============================================================
// T1.4 — Column name whitelist validation
// ============================================================
describe('T1.4: validateColumnName rejects injection columns', () => {
  // We test via batchInsert which calls validateColumnName on Object.keys(data[0])
  // and via query paths that interpolate column names

  it('batchInsert rejects malicious column names', async () => {
    const maliciousData = [{ '1=1; DROP TABLE': 'value' }]
    await expect(batchInsert('test_table', maliciousData)).rejects.toThrow(/invalid column/i)
  })

  it('batchInsert rejects column with spaces', async () => {
    const badData = [{ 'bad column': 'value' }]
    await expect(batchInsert('test_table', badData)).rejects.toThrow(/invalid column/i)
  })

  it('batchInsert rejects column starting with digit', async () => {
    const badData = [{ '1col': 'value' }]
    await expect(batchInsert('test_table', badData)).rejects.toThrow(/invalid column/i)
  })

  it('batchInsert accepts valid snake_case column names', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const goodData = [{ total_score: 1.5, company_name: 'Acme' }]
    await expect(batchInsert('test_table', goodData)).resolves.toBeUndefined()
  })

  it('batchInsert accepts valid camelCase column names', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const goodData = [{ companyName: 'Acme', totalScore: 1.5 }]
    await expect(batchInsert('test_table', goodData)).resolves.toBeUndefined()
  })
})

// ============================================================
// T1.2 — batchInsert multi-row placeholders
// ============================================================
describe('T1.2: batchInsert generates correct multi-row placeholders', () => {
  it('generates correct SQL for 2 rows × 2 fields', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const data = [
      { a: 1, b: 2 },
      { a: 3, b: 4 },
    ]
    await batchInsert('test_table', data, 100)

    expect(mockQuery).toHaveBeenCalledTimes(1)
    const [sql, params] = mockQuery.mock.calls[0]

    // SQL should have two value groups: ($1, $2), ($3, $4)
    expect(sql).toMatch(/\(\$1,\s*\$2\),\s*\(\$3,\s*\$4\)/)
    expect(params).toEqual([1, 2, 3, 4])
  })

  it('generates correct SQL for single row', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const data = [{ x: 'hello', y: 42 }]
    await batchInsert('test_table', data, 100)

    const [sql, params] = mockQuery.mock.calls[0]
    expect(sql).toMatch(/\(\$1,\s*\$2\)/)
    expect(params).toEqual(['hello', 42])
  })

  it('chunks data larger than batchSize', async () => {
    mockQuery.mockResolvedValue({ rows: [] })
    const data = Array.from({ length: 150 }, (_, i) => ({ a: i, b: i * 2 }))

    await batchInsert('test_table', data, 100)

    // 150 items / batch 100 = 2 calls
    expect(mockQuery).toHaveBeenCalledTimes(2)

    // First batch: 100 items
    const [sql1, params1] = mockQuery.mock.calls[0]
    expect(params1).toHaveLength(200) // 100 items × 2 fields

    // Second batch: 50 items
    const [sql2, params2] = mockQuery.mock.calls[1]
    expect(params2).toHaveLength(100) // 50 items × 2 fields
  })

  it('handles empty data gracefully', async () => {
    await batchInsert('test_table', [])
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('generates 3 rows × 3 fields correctly', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const data = [
      { a: 1, b: 2, c: 3 },
      { a: 4, b: 5, c: 6 },
      { a: 7, b: 8, c: 9 },
    ]
    await batchInsert('test_table', data, 100)

    const [sql, params] = mockQuery.mock.calls[0]
    expect(sql).toMatch(/\(\$1,\s*\$2,\s*\$3\),\s*\(\$4,\s*\$5,\s*\$6\),\s*\(\$7,\s*\$8,\s*\$9\)/)
    expect(params).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })
})
