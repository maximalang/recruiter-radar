/**
 * Tests for Telegram Connect types and public API
 * Critical path: type validation, status handling, link state structure
 */

import {
  getTelegramConnectLinkState,
  consumeTelegramConnectToken,
  type TelegramConnectConsumeResult,
  type TelegramConnectLinkState,
} from '../../../lib/telegramConnect';

describe('TelegramConnectLinkState type', () => {
  it('accepts connected=true state', () => {
    const state: TelegramConnectLinkState = {
      connected: true,
      botUsername: 'TestBot',
      connectUrl: null,
      expiresAt: null,
      error: null,
    };
    expect(state.connected).toBe(true);
  });

  it('accepts connected=false with link URL', () => {
    const state: TelegramConnectLinkState = {
      connected: false,
      botUsername: 'TestBot',
      connectUrl: 'https://t.me/TestBot?start=token123',
      expiresAt: '2024-01-01T00:00:00Z',
      error: null,
    };
    expect(state.connected).toBe(false);
    expect(state.connectUrl).toContain('t.me/');
  });

  it('accepts connected=false with error', () => {
    const state: TelegramConnectLinkState = {
      connected: false,
      botUsername: null,
      connectUrl: null,
      expiresAt: null,
      error: 'Telegram bot not configured',
    };
    expect(state.connected).toBe(false);
    expect(state.error).toBeTruthy();
  });
});

describe('TelegramConnectConsumeResult type', () => {
  it('accepts all valid status values', () => {
    const statuses: TelegramConnectConsumeResult['status'][] = [
      'connected', 'invalid', 'expired', 'used', 'error'
    ];

    statuses.forEach(status => {
      const result: TelegramConnectConsumeResult = {
        status,
        message: 'Test message',
        orderId: null,
        clientProfileId: null,
      };
      expect(result.status).toBe(status);
    });
  });

  it('accepts result with orderId', () => {
    const result: TelegramConnectConsumeResult = {
      status: 'connected',
      message: 'Connected successfully',
      orderId: '12345',
      clientProfileId: null,
    };
    expect(result.orderId).toBe('12345');
  });

  it('accepts result with clientProfileId', () => {
    const result: TelegramConnectConsumeResult = {
      status: 'connected',
      message: 'Connected successfully',
      orderId: null,
      clientProfileId: '67890',
    };
    expect(result.clientProfileId).toBe('67890');
  });
});

describe('consumeTelegramConnectToken validation', () => {
  it('returns invalid status for empty token', async () => {
    const result = await consumeTelegramConnectToken({
      token: '',
      telegramChatId: '123456',
    });

    expect(result.status).toBe('invalid');
  });

  it('returns invalid status for empty chat ID', async () => {
    const result = await consumeTelegramConnectToken({
      token: 'valid-token',
      telegramChatId: '',
    });

    expect(result.status).toBe('invalid');
  });

  it('returns invalid status for non-numeric chat ID', async () => {
    const result = await consumeTelegramConnectToken({
      token: 'valid-token',
      telegramChatId: 'not-a-number',
    });

    expect(result.status).toBe('invalid');
  });

  it('throws when database is not configured', async () => {
    await expect(consumeTelegramConnectToken({
      token: 'valid-token',
      telegramChatId: '123456',
    })).rejects.toThrow('DATABASE_URL is not set');
  });
});