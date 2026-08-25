import { GET } from '@/app/api/review/route';
import { getPool } from '@/lib/db';

jest.mock('@/lib/db', () => ({
  getPool: jest.fn(),
}));

jest.mock('@/lib/digestFeedback', () => ({
  updateDigestOrgStateFeedback: jest.fn(),
  DIGEST_FEEDBACK_ACTIONS: ['accepted', 'badfit', 'dismissed', 'snooze', 'contacted', 'replied', 'meeting', 'won'],
  isDigestFeedbackAction: jest.fn(),
  DEFAULT_BADFIT_SUPPRESSION_DAYS: 30,
  buildDigestFeedbackActionPlan: jest.fn(),
}));

jest.mock('@/lib/auth-v2/authorization', () => ({
  getSession: jest.fn(async () => ({ dataOwnerId: 'owner-1', workspaceId: 'workspace-9' })),
}));

jest.mock('@/lib/entitlements', () => ({
  hasFeatureAccess: jest.fn(async () => true),
}));

const mockGetPool = getPool as jest.MockedFunction<typeof getPool>;

describe('GET /api/review pagination validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['limit=NaN', 'limit must be an integer between 1 and 200.'],
    ['limit=-1', 'limit must be an integer between 1 and 200.'],
    ['limit=201', 'limit must be an integer between 1 and 200.'],
    ['limit=1.5', 'limit must be an integer between 1 and 200.'],
    ['offset=NaN', 'offset must be a non-negative integer.'],
    ['offset=-1', 'offset must be a non-negative integer.'],
    ['offset=1.5', 'offset must be a non-negative integer.'],
  ])('returns 400 for invalid %s before touching the database', async (query, error) => {
    const response = await GET(new Request(`http://localhost/api/review?clientProfileId=1&${query}`));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error });
    expect(mockGetPool).not.toHaveBeenCalled();
  });
});
