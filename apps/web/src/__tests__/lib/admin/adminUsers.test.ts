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
  updateClientSettingsForUser,
  resolveAdminDataOwnerId,
  sendUserLoginLink,
} from '@/lib/admin/adminUsers';
import { getPool } from '@/lib/db-pool';
import {
  getEffectiveEntitlement,
  grantEntitlement,
  revokeEntitlement,
} from '@/lib/entitlements';
import { requestAuthV2Login, shouldRequestAuthV2Login } from '@/lib/auth-v2/challenges';
import { requestAccountLogin } from '@/lib/account-auth';

jest.mock('@/lib/db-pool', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/entitlements', () => ({
  extendEntitlement: jest.fn(),
  getEffectiveEntitlement: jest.fn(),
  grantEntitlement: jest.fn(),
  grantEntitlementUntil: jest.fn(),
  revokeEntitlement: jest.fn(),
}));
jest.mock('@/lib/auth-v2/challenges', () => ({
  requestAuthV2Login: jest.fn(),
  shouldRequestAuthV2Login: jest.fn(),
}));
jest.mock('@/lib/account-auth', () => ({ requestAccountLogin: jest.fn() }));
jest.mock('@/lib/runtime', () => ({
  logEvent: jest.fn(),
  logError: jest.fn(),
  logWarn: jest.fn(),
}));

const mockGetPool = jest.mocked(getPool);
const mockGrantEntitlement = jest.mocked(grantEntitlement);
const mockGetEffectiveEntitlement = jest.mocked(getEffectiveEntitlement);
const mockRevokeEntitlement = jest.mocked(revokeEntitlement);
const mockQuery = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockGetEffectiveEntitlement.mockResolvedValue({ status: 'inactive', source: null, plan: null, startsAt: null, expiresAt: null, features: [], activeSources: [], reason: 'no_active_entitlement' });
  mockGetPool.mockReturnValue({ query: mockQuery } as never);
});

describe('adminUsers — id validation', () => {
  it('rejects a non-numeric userId without touching the DB', async () => {
    const r = await activatePilotForUser('abc', '9');
    expect(r.ok).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects a zero / negative userId', async () => {
    const r = await pausePilotForUser('0', '9');
    expect(r.ok).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects SQL-injection-shaped ids', async () => {
    const r = await setProfileActive("1; DROP TABLE users;--", '9', false);
    expect(r.ok).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('adminUsers — no pool', () => {
  it('returns ok:false when there is no DB pool', async () => {
    mockGetPool.mockReturnValue(null as never);
    const r = await activatePilotForUser('5', '9');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('недоступна');
  });
});

describe('adminUsers — activate pilot', () => {
  it('atomically ensures a canonical admin grant', async () => {
    mockGrantEntitlement.mockResolvedValueOnce({ changed: true, grantId: '10' });
    const r = await activatePilotForUser('5', '9');
    expect(r.ok).toBe(true);
    expect(r.message).toContain('активирован');
    expect(mockGrantEntitlement).toHaveBeenCalledWith({
      userId: '5',
      workspaceId: '9',
      source: 'admin',
      plan: 'radar-admin-7',
      durationDays: 7,
      features: ['dashboard', 'api', 'digest', 'delivery'],
    });
  });

  it('creates a canonical admin grant when none exists', async () => {
    mockGrantEntitlement.mockResolvedValueOnce({ changed: true, grantId: '11' });
    const r = await activatePilotForUser('7', '9');
    expect(r.ok).toBe(true);
    expect(mockGrantEntitlement).toHaveBeenCalledWith({
      userId: '7',
      workspaceId: '9',
      source: 'admin',
      plan: 'radar-admin-7',
      durationDays: 7,
      features: ['dashboard', 'api', 'digest', 'delivery'],
    });
  });
});

describe('adminUsers — canonical data owner', () => {
  it('resolves a team member inside the workspace selected by the operator', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ dataOwnerId: '7' }] });

    await expect(resolveAdminDataOwnerId('42', '9')).resolves.toBe('7');

    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('workspace_members'), ['42', '9']);
    expect(String(mockQuery.mock.calls[0]?.[0])).toContain('bootstrap_user_id');
  });

  it('fails closed before querying when the explicit workspace id is invalid', async () => {
    await expect(resolveAdminDataOwnerId('42', '')).resolves.toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('adminUsers — operator login link', () => {
  it('does not claim a link was sent when duplicate protection suppresses delivery', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ email: 'member@example.test' }] });
    jest.mocked(shouldRequestAuthV2Login).mockResolvedValue(false);
    jest.mocked(requestAccountLogin).mockResolvedValue({ ok: true, delivery: 'suppressed' });

    await expect(sendUserLoginLink('42', '/dashboard')).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining('подавлен'),
    });
    expect(requestAuthV2Login).not.toHaveBeenCalled();
  });
});

describe('adminUsers — client settings', () => {
  it('updates only the exact owner profile with validated canonical options', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [] });
    await expect(updateClientSettingsForUser('42', '9', {
      agencyName: 'North Star', specialization: 'Data', targetCity: 'Москва',
      roles: ['data'], industries: ['it'], companySizes: ['small'], dailyDigestLimit: 7,
      hiringIntentMin: 2.5, signalFreshnessDays: 14, minOpenRoles: 2,
    })).resolves.toMatchObject({ ok: true });
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('WHERE owner_id = $1'),
      ['42', 'North Star', 'Data', 'Москва', ['data'], '["it"]', '["small"]', 7, 2.5, 14, 2, '9'],
    );
  });

  it('rejects forged option values before querying', async () => {
    await expect(updateClientSettingsForUser('42', '9', {
      agencyName: 'North Star', specialization: null, targetCity: null,
      roles: ['forged'], industries: [], companySizes: [], dailyDigestLimit: 5,
      hiringIntentMin: null, signalFreshnessDays: null, minOpenRoles: null,
    })).resolves.toMatchObject({ ok: false });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('adminUsers — pause pilot', () => {
  it('revokes active canonical admin grants', async () => {
    mockRevokeEntitlement.mockResolvedValueOnce({ changed: true, count: 1 });
    const r = await pausePilotForUser('5', '9');
    expect(r.ok).toBe(true);
    expect(mockRevokeEntitlement).toHaveBeenCalledWith({
      userId: '5',
      workspaceId: '9',
      source: 'admin',
    });
  });

  it('reports not-ok when there is no active pilot to pause', async () => {
    mockRevokeEntitlement.mockResolvedValueOnce({ changed: false, count: 0 });
    const r = await pausePilotForUser('5', '9');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('нечего');
  });
});

describe('adminUsers — profile active toggle', () => {
  it('updates is_active on the user-owned profile', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    const r = await setProfileActive('5', '9', false);
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
    const r = await setProfileActive('5', '9', true);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('нет профиля');
  });
});

describe('adminUsers — clear telegram', () => {
  it('nulls telegram_chat_id on the user-owned profile', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    const r = await clearProfileTelegram('5', '9');
    expect(r.ok).toBe(true);
    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toContain('telegram_chat_id = NULL');
    expect(sql).toContain('owner_id = $1');
  });

  it('reports not-ok when Telegram was not linked', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    const r = await clearProfileTelegram('5', '9');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('не привязан');
  });
});

describe('adminUsers — error resilience', () => {
  it('returns ok:false with the error message on a DB error (never throws)', async () => {
    mockGrantEntitlement.mockRejectedValueOnce(new Error('connection refused'));
    const r = await activatePilotForUser('5', '9');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('connection refused');
  });
});
