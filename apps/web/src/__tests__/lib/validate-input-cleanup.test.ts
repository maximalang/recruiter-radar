/**
 * T4.1: Remove regex value validation from validateInput
 *
 * Parameterized queries already protect against SQL injection.
 * The regex blocks legitimate data like "O'Reilly", "IT AND Telecom".
 */

// Mock the pool
const mockQuery = jest.fn()
jest.mock('@/lib/db', () => ({
  getPool: () => ({ query: mockQuery, connect: () => ({ query: mockQuery, release: jest.fn() }) }),
}))

import { query, batchInsert } from '@/lib/typed-db'

beforeEach(() => {
  mockQuery.mockReset()
})

describe('T4.1: Legitimate values pass through validateInput', () => {
  it('O\'Reilly passes as a query value', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    // Use query with a WHERE condition containing O'Reilly
    await query("SELECT * FROM test WHERE name = $1", ["O'Reilly"])
    expect(mockQuery).toHaveBeenCalledWith("SELECT * FROM test WHERE name = $1", ["O'Reilly"])
  })

  it('IT AND Telecom passes as a batchInsert value', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await batchInsert('test_table', [{ company_name: 'IT AND Telecom', score: 1.5 }])
    expect(mockQuery).toHaveBeenCalledTimes(1)
    const [sql, params] = mockQuery.mock.calls[0]
    expect(params).toContain('IT AND Telecom')
  })

  it('value with semicolon passes (parameterized queries are safe)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await batchInsert('test_table', [{ name: 'test; value', score: 1 }])
    const [sql, params] = mockQuery.mock.calls[0]
    expect(params).toContain('test; value')
  })

  it('value with quotes passes', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await batchInsert('test_table', [{ name: "it's a test", score: 1 }])
    const [sql, params] = mockQuery.mock.calls[0]
    expect(params).toContain("it's a test")
  })
})
