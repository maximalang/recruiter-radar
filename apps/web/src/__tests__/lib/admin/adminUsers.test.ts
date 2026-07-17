/**
 * Tests for the admin user-management DB layer (lib/admin/adminUsers.ts).
 *
 * Locks the functional + safety contract:
 *   - userId is validated (non-numeric rejected, no string interpolation into SQL)
 *   - each write names ONE column / inserts ONE enrollment — never touches
 *     total_score / confidence_gate / evidence / checkout_orders
 *   - pilot activation extends an existing active enrollment rather than
 *     duplicating (respects the unique-active-user index)
 *   - actions degrade to {ok:false, message} on DB error / no pool
 */

import {
  activatePilotForUser,
  pausePilotForUser,
  setProfileActive,
  clearProfileTelegram,
} from '@/lib/admin/adminUsers';
import { getPool } from '@/lib/db-pool';

jest.mock('@/lib/db-pool', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/runtime', () => ({
  logEvent: jest.fn(),
  logError: jest.fn(),
  logWarn: jest.fn(),
}));

const mockGetPool = jest.mocked(getPool);
const mockQuery = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPool.mockReturnValue({ query: mockQuery } as never);
});

describe('adminUsers — id validation', () => {
  it('rejects a non-numeric userId without touching the DB', async () => {
    const r = await activatePilotForUser('abc');
    expect(r.ok).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects a zero / negative userId', async () => {
    const r = await pausePilotForUser('0');
    expect(r.ok).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects SQL-injection-shaped ids', async () => {
    const r = await setProfileActive("1; DROP TABLE users;--", false);
    expect(r.ok).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('adminUsers — no pool', () => {
  it('returns ok:false when there is no DB pool', async () => {
    mockGetPool.mockReturnValue(null as never);
    const r = await activatePilotForUser('5');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('недоступна');
  });
});

describe('adminUsers — activate pilot', () => {
  it('extends an existing active enrollment rather than inserting', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE extends
    const r = await activatePilotForUser('5');
    expect(r.ok).toBe(true);
    expect(r.message).toContain('продлён');
    // only the extend UPDATE ran — no insert
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toContain('UPDATE pilot_enrollments');
    expect(sql).toContain('ends_at');
    // parameterized — no interpolated id
    expect(mockQuery.mock.calls[0][1]).toEqual(['7', '5']);
  });

  it('claims an existing requested enrollment when no active one to extend', async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 0 }) // extend: nothing active
      .mockResolvedValueOnce({ rowCount: 1 }); // claim requested → active
    const r = await activatePilotForUser('6');
    expect(r.ok).toBe(true);
    expect(r.message).toContain('по заявке');
    const claimSql = String(mockQuery.mock.calls[1][0]);
    expect(claimSql).toContain("status = 'active'");
    expect(claimSql).toContain("activated_by = 'admin'");
  });

  it('inserts a fresh active enrollment when none exists', async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 0 }) // extend: nothing
      .mockResolvedValueOnce({ rowCount: 0 }); // claim: nothing requested
    const r = await activatePilotForUser('7');
    expect(r.ok).toBe(true);
    const insertSql = String(mockQuery.mock.calls[2][0]);
    expect(insertSql).toContain('INSERT INTO pilot_enrollments');
    expect(insertSql).toContain("'active'");
    expect(insertSql).toContain("'admin'");
  });
});

describe('adminUsers — pause pilot', () => {
  it('marks an active enrollment canceled', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    const r = await pausePilotForUser('5');
    expect(r.ok).toBe(true);
    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toContain("status = 'canceled'");
  });

  it('reports not-ok when there is no active pilot to pause', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    const r = await pausePilotForUser('5');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('нечего');
  });
});

describe('adminUsers — profile active toggle', () => {
  it('updates is_active on the user-owned profile', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    const r = await setProfileActive('5', false);
    expect(r.ok).toBe(true);
    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toContain('UPDATE client_profiles');
    expect(sql).toContain('is_active = $1');
    expect(sql).toContain('owner_id = $2');
    // trust: never touches deterministic / billing columns
    expect(sql).not.toContain('total_score');
    expect(sql).not.toContain('confidence_gate');
  });

  it('reports not-ok when the user has no profile', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    const r = await setProfileActive('5', true);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('нет профиля');
  });
});

describe('adminUsers — clear telegram', () => {
  it('nulls telegram_chat_id on the user-owned profile', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    const r = await clearProfileTelegram('5');
    expect(r.ok).toBe(true);
    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toContain('telegram_chat_id = NULL');
    expect(sql).toContain('owner_id = $1');
  });

  it('reports not-ok when Telegram was not linked', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    const r = await clearProfileTelegram('5');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('не привязан');
  });
});

describe('adminUsers — error resilience', () => {
  it('returns ok:false with the error message on a DB error (never throws)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));
    const r = await activatePilotForUser('5');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('connection refused');
  });
});
