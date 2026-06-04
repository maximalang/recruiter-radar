/**
 * Tests for sendOutreachToTelegramAction.
 *
 * Verifies that the server action validates input,
 * checks ownership + chat_id in one query, and sends the message.
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

/**
 * Mock the combined ownership + chat_id lookup query.
 * Returns a single row with { ok: true, telegram_chat_id: chatId }.
 */
function mockOwnerWithChat(chatId: string | null) {
  mockGetOwnerIdFromSession.mockResolvedValue('owner123');
  makeMockPool();
  mockQuery.mockResolvedValueOnce({
    rowCount: 1,
    rows: [{ ok: true, telegram_chat_id: chatId }],
  });
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
    if (!result.ok) expect(result.error).toContain('no active session');
  });

  it('rejects when pool is not available', async () => {
    mockGetOwnerIdFromSession.mockResolvedValue('owner123');
    mockGetPool.mockReturnValue(null);
    const result = await sendOutreachToTelegramAction('1', 'Hello');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Database');
  });

  it('rejects when ownership check fails (profile not found or wrong owner)', async () => {
    makeMockPool();
    mockGetOwnerIdFromSession.mockResolvedValue('owner123');
    // Combined query returns no rows
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const result = await sendOutreachToTelegramAction('1', 'Hello');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Access denied');
  });

  it('returns error when profile has no telegram chat id', async () => {
    mockOwnerWithChat(null);

    const result = await sendOutreachToTelegramAction('1', 'Hello');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Telegram');
  });

  it('returns error when bot token is not configured', async () => {
    mockOwnerWithChat('12345');
    mockGetTelegramBotToken.mockReturnValue({ botToken: null, error: 'No token' });

    const result = await sendOutreachToTelegramAction('1', 'Hello');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Telegram');
  });

  it('sends message successfully', async () => {
    mockOwnerWithChat('12345');
    mockGetTelegramBotToken.mockReturnValue({ botToken: 'test-token', error: null });
    mockSendTelegramTextMessage.mockResolvedValueOnce({ chatId: '12345', messageId: 42 });

    const result = await sendOutreachToTelegramAction('1', 'Здравствуйте!');
    expect(result.ok).toBe(true);
    expect(mockSendTelegramTextMessage).toHaveBeenCalledWith(
      'Здравствуйте!',
      { botToken: 'test-token', chatId: '12345' },
    );
    // Only 1 query (combined ownership + chat_id)
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('handles telegram send failure', async () => {
    mockOwnerWithChat('12345');
    mockGetTelegramBotToken.mockReturnValue({ botToken: 'test-token', error: null });
    mockSendTelegramTextMessage.mockRejectedValueOnce(new Error('Network error'));

    const result = await sendOutreachToTelegramAction('1', 'Hello');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Network error');
  });

  it('allows access when owner_id IS NULL (pilot/anonymous profile)', async () => {
    mockGetOwnerIdFromSession.mockResolvedValue('owner123');
    makeMockPool();
    // Query returns row with chat_id — the SQL handles OR owner_id IS NULL
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ ok: true, telegram_chat_id: '12345' }],
    });
    mockGetTelegramBotToken.mockReturnValue({ botToken: 'test-token', error: null });
    mockSendTelegramTextMessage.mockResolvedValueOnce({ chatId: '12345', messageId: 42 });

    const result = await sendOutreachToTelegramAction('1', 'Hello');
    expect(result.ok).toBe(true);
  });
});
