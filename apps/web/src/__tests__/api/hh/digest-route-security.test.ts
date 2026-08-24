import { GET } from '@/app/api/hh/digest/route';
import { assertDigestEntitlementByClientProfileId } from '@/lib/db';
import { getHhDigestItems } from '@/lib/hhDigest';

jest.mock('@/lib/db', () => ({
  assertDigestEntitlementByClientProfileId: jest.fn(),
}));

jest.mock('@/lib/hhDigest', () => ({
  getHhDigestItems: jest.fn(),
}));

const mockAssertEntitlement = assertDigestEntitlementByClientProfileId as jest.MockedFunction<typeof assertDigestEntitlementByClientProfileId>;
const mockGetDigestItems = getHhDigestItems as jest.MockedFunction<typeof getHhDigestItems>;

function request() {
  return new Request('http://localhost/api/hh/digest?clientProfileId=42', {
    headers: { 'x-api-key': 'test-key' },
  });
}

describe('GET /api/hh/digest security', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DIGEST_API_KEY = 'test-key';
    delete process.env.DAILY_DIGEST_CLIENT_PROFILE_ID;
  });

  afterEach(() => {
    delete process.env.DIGEST_API_KEY;
    delete process.env.DAILY_DIGEST_CLIENT_PROFILE_ID;
  });

  it('does not expose configuration variable names when disabled', async () => {
    delete process.env.DIGEST_API_KEY;

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Digest API is unavailable.' });
    expect(JSON.stringify(body)).not.toContain('DIGEST_API_KEY');
  });

  it('redacts unexpected database/runtime errors', async () => {
    mockAssertEntitlement.mockResolvedValueOnce(undefined);
    mockGetDigestItems.mockRejectedValueOnce(new Error('connect ECONNREFUSED postgres.internal:5432 password=secret'));

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to load HH digest.' });
    expect(JSON.stringify(body)).not.toContain('postgres.internal');
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('preserves entitlement status without exposing internal details', async () => {
    mockAssertEntitlement.mockRejectedValueOnce(new Error('No active subscription for owner 17')); 

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'entitlement_required' });
    expect(JSON.stringify(body)).not.toContain('owner 17');
  });
});
