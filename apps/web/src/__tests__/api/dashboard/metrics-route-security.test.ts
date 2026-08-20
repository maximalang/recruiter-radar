import { GET } from '@/app/api/dashboard/metrics/route';
import { getDashboardQualityMetrics } from '@/lib/dashboard-data';

jest.mock('@/lib/dashboard-data', () => ({
  getDashboardQualityMetrics: jest.fn(),
}));

const mockMetrics = getDashboardQualityMetrics as jest.MockedFunction<typeof getDashboardQualityMetrics>;
const OLD_ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const OLD_INGEST_API_KEY = process.env.INGEST_API_KEY;

function req(key?: string) {
  const headers: Record<string, string> = {};
  if (key !== undefined) headers['x-api-key'] = key;
  return GET(new Request('http://localhost/api/dashboard/metrics', { headers }) as never);
}

describe('GET /api/dashboard/metrics security', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ADMIN_API_KEY = 'operator-secret';
    delete process.env.INGEST_API_KEY;
  });

  afterAll(() => {
    process.env.ADMIN_API_KEY = OLD_ADMIN_API_KEY;
    process.env.INGEST_API_KEY = OLD_INGEST_API_KEY;
  });

  it('does not expose runtime or database diagnostics', async () => {
    mockMetrics.mockRejectedValue(
      new Error('connect ECONNREFUSED postgres.internal:5432 password=super-secret'),
    );

    const res = await req('operator-secret');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Dashboard metrics are temporarily unavailable.');
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('ECONNREFUSED');
    expect(serialized).not.toContain('postgres.internal');
    expect(serialized).not.toContain('super-secret');
  });

  it('keeps the endpoint fail-closed when the operator key is absent', async () => {
    delete process.env.ADMIN_API_KEY;
    delete process.env.INGEST_API_KEY;

    const res = await req('anything');
    expect(res.status).toBe(500);
    expect(mockMetrics).not.toHaveBeenCalled();
  });
});
