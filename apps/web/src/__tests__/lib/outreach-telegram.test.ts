/**
 * Tests for sendOutreachToTelegramAction.
 *
 * Verifies that the server action validates input,
 * looks up the Telegram chat ID, and sends the message.
 */

import { sendOutreachToTelegramAction } from '@/app/leads/[id]/actions';
import { getPool } from '@/lib/db';
import { getTelegramBotToken, sendTelegramTextMessage } from '@/lib/telegram';

jest.mock('@/lib/db', () => ({
  getPool: jest.fn(),
}));

jest.mock('@/lib/telegram', () => ({
  getTelegramBotToken: jest.fn(),
  sendTelegramTextMessage: jest.fn(),
}));

const mockGetPool = getPool as jest.MockedFunction<typeof getPool>;
const mockGetTelegramBotToken = getTelegramBotToken as jest.MockedFunction<typeof getTelegramBotToken>;
const mockSendTelegramTextMessage = sendTelegramTextMessage as jest.MockedFunction<typeof sendTelegramTextMessage>;

const mockQuery = jest.fn();

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

  it('returns error when pool is not available', async () => {
    mockGetPool.mockReturnValue(null);
    const result = await sendOutreachToTelegramAction('1', 'Hello');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Database');
  });

  it('returns error when profile has no telegram chat id', async () => {
    mockGetPool.mockReturnValue({ query: mockQuery } as never);
    mockQuery.mockResolvedValueOnce({ rows: [{ telegram_chat_id: null }] });

    const result = await sendOutreachToTelegramAction('1', 'Hello');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Telegram');
  });

  it('returns error when bot token is not configured', async () => {
    mockGetPool.mockReturnValue({ query: mockQuery } as never);
    mockQuery.mockResolvedValueOnce({ rows: [{ telegram_chat_id: '12345' }] });
    mockGetTelegramBotToken.mockReturnValue({ botToken: null, error: 'No token' });

    const result = await sendOutreachToTelegramAction('1', 'Hello');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Telegram');
  });

  it('sends message successfully', async () => {
    mockGetPool.mockReturnValue({ query: mockQuery } as never);
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
    mockGetPool.mockReturnValue({ query: mockQuery } as never);
    mockQuery.mockResolvedValueOnce({ rows: [{ telegram_chat_id: '12345' }] });
    mockGetTelegramBotToken.mockReturnValue({ botToken: 'test-token', error: null });
    mockSendTelegramTextMessage.mockRejectedValueOnce(new Error('Network error'));

    const result = await sendOutreachToTelegramAction('1', 'Hello');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Network error');
  });
});
