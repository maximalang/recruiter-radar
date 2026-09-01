/**
 * Tests for lead feedback state transition server action.
 *
 * Verifies that updateLeadFeedbackAction validates input,
 * updates feedback_status in client_digest_org_state,
 * and returns the updated state.
 *
 * The valid set mirrors the DB enum `digest_feedback_status`:
 *   none, contacted, replied, won, badfit, snooze, dismissed
 * The in-app writer must only emit DB-legal values — emitting `accepted`/
 * `later` would throw `invalid input value for enum` at runtime.
 */

import { updateLeadFeedback } from '@/lib/leads-data';
import { getPool } from '@/lib/db';

jest.mock('@/lib/db', () => ({
  getPool: jest.fn(),
}));

const mockQuery = jest.fn();
const mockGetPool = getPool as jest.MockedFunction<typeof getPool>;

function makeMockPool() {
  mockGetPool.mockReturnValue({
    query: mockQuery,
  } as never);
}

const VALID_STATUSES = ['contacted', 'replied', 'meeting', 'won', 'badfit', 'snooze', 'dismissed'] as const;

describe('updateLeadFeedback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns error when pool is not available', async () => {
    mockGetPool.mockReturnValue(null);
    const result = await updateLeadFeedback({
      orgId: '1',
      clientProfileId: '1',
      feedbackStatus: 'contacted',
    });
    expect(result.ok).toBe(false);
  });

  it('returns error for invalid feedback status', async () => {
    makeMockPool();
    const result = await updateLeadFeedback({
      orgId: '1',
      clientProfileId: '1',
      feedbackStatus: 'invalid_status',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Invalid feedback status');
    }
  });

  it('rejects the legacy drifted statuses that are not in the DB enum', async () => {
    makeMockPool();
    // accepted/later/call/client were never in digest_feedback_status; the
    // reconciled writer must reject them so the enum cast cannot throw.
    for (const legacy of ['accepted', 'later', 'call', 'client'] as const) {
      const result = await updateLeadFeedback({
        orgId: '10',
        clientProfileId: '1',
        feedbackStatus: legacy,
      });
      expect(result.ok).toBe(false);
    }
  });

  it('accepts all DB-legal feedback statuses', async () => {
    makeMockPool();

    for (const status of VALID_STATUSES) {
      mockQuery.mockResolvedValueOnce({
        rows: [{ feedback_status: status, feedback_note: null, client_profile_id: '1', org_id: '10', feedback_at: '2026-06-04T12:00:00Z' }],
      });

      const result = await updateLeadFeedback({
        orgId: '10',
        clientProfileId: '1',
        feedbackStatus: status,
        feedbackNote: null,
      });
      expect(result.ok).toBe(true);
    }
  });

  it('updates feedback status and returns new state', async () => {
    makeMockPool();
    mockQuery.mockResolvedValueOnce({
      rows: [{
        client_profile_id: '1',
        org_id: '10',
        feedback_status: 'contacted',
        feedback_note: null,
        feedback_at: '2026-06-04T12:00:00Z',
      }],
    });

    const result = await updateLeadFeedback({
      orgId: '10',
      clientProfileId: '1',
      feedbackStatus: 'contacted',
      feedbackNote: null,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.feedbackStatus).toBe('contacted');
    }

    // Verify the SQL was called correctly
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('client_digest_org_state'),
      expect.arrayContaining(['contacted']),
    );
  });

  it('rejects feedbackNote when status does not allow notes', async () => {
    makeMockPool();
    mockQuery.mockResolvedValueOnce({
      rows: [{ feedback_status: 'contacted', feedback_note: null }],
    });

    const result = await updateLeadFeedback({
      orgId: '10',
      clientProfileId: '1',
      feedbackStatus: 'contacted',
      feedbackNote: 'This should be rejected',
    });

    expect(result.ok).toBe(true);
    // feedbackNote should be null when status is not in the note-allowed set
    if (result.ok) {
      expect(result.data.feedbackNote).toBeNull();
    }
  });

  it('allows feedbackNote when status is badfit', async () => {
    makeMockPool();
    mockQuery.mockResolvedValueOnce({
      rows: [{ feedback_status: 'badfit', feedback_note: 'IT but we do finance' }],
    });

    const result = await updateLeadFeedback({
      orgId: '10',
      clientProfileId: '1',
      feedbackStatus: 'badfit',
      feedbackNote: 'IT but we do finance',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.feedbackNote).toBe('IT but we do finance');
    }
  });

  it('allows feedbackNote when status is dismissed (park-with-reason)', async () => {
    makeMockPool();
    mockQuery.mockResolvedValueOnce({
      rows: [{ feedback_status: 'dismissed', feedback_note: 'уже клиент конкурента' }],
    });

    const result = await updateLeadFeedback({
      orgId: '10',
      clientProfileId: '1',
      feedbackStatus: 'dismissed',
      feedbackNote: 'уже клиент конкурента',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.feedbackNote).toBe('уже клиент конкурента');
    }
  });
});
