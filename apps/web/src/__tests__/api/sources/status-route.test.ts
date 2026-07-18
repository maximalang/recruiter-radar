/**
 * Tests for GET /api/sources/status — internal-admin source health summary.
 * API-key gated (INGEST_API_KEY), returns registry + health, no tenant data.
 */

import { GET } from '@/app/api/sources/status/route';
import { getDashboardSourceHealth } from '@/lib/dashboard-data';

jest.mock('@/lib/dashboard-data', () => ({
  getDashboardSourceHealth: jest.fn(),
}));

const mockHealth = getDashboardSourceHealth as jest.MockedFunction<typeof getDashboardSourceHealth>;

const OLD_ENV = process.env.INGEST_API_KEY;

function req(key?: string) {
  const headers: Record<string, string> = {};
  if (key !== undefined) headers['x-api-key'] = key;
  return GET(new Request('http://localhost/api/sources/status', { headers }) as never);
}

describe('GET /api/sources/status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.INGEST_API_KEY = 'secret-key';
    mockHealth.mockResolvedValue([]);
  });
  afterAll(() => {
    process.env.INGEST_API_KEY = OLD_ENV;
  });

  it('500s when INGEST_API_KEY is not configured', async () => {
    delete process.env.INGEST_API_KEY;
    const res = await req('anything');
    expect(res.status).toBe(500);
  });

  it('401s without the api key', async () => {
    const res = await req();
    expect(res.status).toBe(401);
  });

  it('401s with a wrong api key', async () => {
    const res = await req('wrong');
    expect(res.status).toBe(401);
  });

  it('returns the source registry + health with a valid key', async () => {
    mockHealth.mockResolvedValue([
      { id: 'career-pages', name: 'Career Pages', overall: 90, lastRun: '2026-06-30T00:00:00Z', recordsProcessed: 5, errors: 0, status: 'excellent' },
    ]);
    const res = await req('secret-key');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.sources)).toBe(true);
    expect(body.summary.total).toBe(15);
    const cp = body.sources.find((s: { id: string }) => s.id === 'career-pages');
    expect(cp.health.recordsLast24h).toBe(5);
    expect(cp.isPrimary).toBe(true);
    for (const contextSourceId of ['company-newsrooms', 'industry-media', 'linkedin-company-pages']) {
      const source = body.sources.find((item: { id: string }) => item.id === contextSourceId);
      expect(source).toBeDefined();
      expect(source.isPrimary).toBe(false);
    }
    const superjob = body.sources.find((item: { id: string }) => item.id === 'superjob');
    expect(superjob.requiredEnvVars).toEqual([]);
  });

  it('still returns registry when health computation fails', async () => {
    mockHealth.mockRejectedValue(new Error('db down'));
    const res = await req('secret-key');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sources.length).toBeGreaterThan(0);
    expect(body.sources[0].health).toBeNull();
  });
});
