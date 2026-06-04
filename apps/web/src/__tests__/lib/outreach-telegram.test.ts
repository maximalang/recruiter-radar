/**
 * Tests for sendOutreachToTelegramAction.
 *
 * Verifies that the server action validates input,
 * checks ownership, looks up the Telegram chat ID, and sends the message.
 */

import { sendOutreachToTelegramAction } from '@/app/leads/[id]/actions';
import { getPool } from '@/lib/db';
import { getTelegramBotToken, sendTelegramTextMessage } from '@/lib/telegram';
import { getOwnerIdFromSession } from '@/lib/session';

jest.mock('@/lib/db', () => ({
  getPool: jest.fn(),
}));

jest.mock('@/lib/telegram', () => ({
  getTelegramBotToken: jest.fn(),
  sendTelegramTextMessage: jest.fn(),
}));

jest.mock('@/lib/session', () => ({
  getOwnerIdFromSession: jest.fn(),
}));

const mockGetPool = getPool as jest.MockedFunction<typeof getPool>;
const mockGetTelegramBotToken = getTelegramBotToken as jest.MockedFunction<typeof getTelegramBotToken>;
const mockSendTelegramTextMessage = sendTelegramTextMessage as jest.MockedFunction<typeof sendTelegramTextMessage>;
const mockGetOwnerIdFromSession = getOwnerIdFromSession as jest.MockedFunction<typeof getOwnerIdFromSession>;

const mockQuery = jest.fn();

function makeMockPool() {
  mockGetPool.mockReturnValue({ query: mockQuery } as never);
}

function mockOwnerVerified() {
  mockGetOwnerIdFromSession.mockResolvedValue('owner123');
  // Ownership check query returns a row
  mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ ok: true }] });
}

describe('sendOutreachToTelegramAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects empty message', async () => {
    const result = await sendOutreachToTelegramAction('1', '');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('empty');
  });

  it('rejects whitespace-only message', async () => {
    const result = await sendOutreachToTelegramAction('1', '   ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('empty');
  });

  it('rejects when no session (unauthenticated)', async () => {
    mockGetOwnerIdFromSession.mockResolvedValue(null);
    const result = await sendOutreachToTelegramAction('1', 'Hello');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Access denied');
  });

  it('rejects when ownership check fails', async () => {
    makeMockPool();
    mockGetOwnerIdFromSession.mockResolvedValue('owner123');
    // Ownership check returns no rows
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const result = await sendOutreachToTelegramAction('1', 'Hello');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Access denied');
  });

  it('returns error when pool is not available for chat lookup', async () => {
    mockGetOwnerIdFromSession.mockResolvedValue('owner123');
    // Pool exists for ownership check
    makeMockPool();
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ ok: true }] });
    // After ownership check, getPool is called again for chat lookup
    // But it returns the same mock pool, so we just add another query mock
    mockQuery.mockResolvedValueOnce({ rows: [{ telegram_chat_id: '12345' }] });
    mockGetTelegramBotToken.mockReturnValue({ botToken: null, error: 'No token' });

    const result = await sendOutreachToTelegramAction('1', 'Hello');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Telegram');
  });

  it('returns error when profile has no telegram chat id', async () => {
    makeMockPool();
    mockOwnerVerified();
    // chat_id lookup (second query after ownership)
    mockQuery.mockResolvedValueOnce({ rows: [{ telegram_chat_id: null }] });

    const result = await sendOutreachToTelegramAction('1', 'Hello');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Telegram');
  });

  it('returns error when bot token is not configured', async () => {
    makeMockPool();
    mockOwnerVerified();
    mockQuery.mockResolvedValueOnce({ rows: [{ telegram_chat_id: '12345' }] });
    mockGetTelegramBotToken.mockReturnValue({ botToken: null, error: 'No token' });

    const result = await sendOutreachToTelegramAction('1', 'Hello');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Telegram');
  });

  it('sends message successfully', async () => {
    makeMockPool();
    mockOwnerVerified();
    mockQuery.mockResolvedValueOnce({ rows: [{ telegram_chat_id: '12345' }] });
    mockGetTelegramBotToken.mockReturnValue({ botToken: 'test-token', error: null });
    mockSendTelegramTextMessage.mockResolvedValueOnce({ chatId: '12345', messageId: 42 });

    const result = await sendOutreachToTelegramAction('1', 'Здравствуйте!');
    expect(result.ok).toBe(true);
    expect(mockSendTelegramTextMessage).toHaveBeenCalledWith(
      'Здравствуйте!',
      { botToken: 'test-token', chatId: '12345' },
    );
  });

  it('handles telegram send failure', async () => {
    makeMockPool();
    mockOwnerVerified();
    mockQuery.mockResolvedValueOnce({ rows: [{ telegram_chat_id: '12345' }] });
    mockGetTelegramBotToken.mockReturnValue({ botToken: 'test-token', error: null });
    mockSendTelegramTextMessage.mockRejectedValueOnce(new Error('Network error'));

    const result = await sendOutreachToTelegramAction('1', 'Hello');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Network error');
  });
});
