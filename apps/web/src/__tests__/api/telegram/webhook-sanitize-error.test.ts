/**
 * Tests for sanitizeError — redacts Telegram bot tokens before they reach
 * persisted error_message columns or HTTP error responses.
 *
 * Token shape: numeric bot id (>= 8 digits) ":" 35+ char auth string.
 * Both URL-embedded ("bot<id>:<auth>") and bare ("<id>:<auth>") forms must be redacted.
 */

import { sanitizeTelegramWebhookError as sanitizeError } from '@/lib/telegram-webhook-security';

// Realistic-looking token: 10-digit id + ":" + 35-char auth (mix of letters, digits, _ and -).
const AUTH_35 = 'AAH1bCdEfGhIjKlMnOpQrStUvWxYz012-_3';
const TOKEN = `1234567890:${AUTH_35}`;

describe('sanitizeError', () => {
  it('redacts a bare Telegram token', () => {
    expect(sanitizeError(`request failed for token ${TOKEN}`)).toBe(
      'request failed for token [redacted-token]',
    );
  });

  it('redacts a URL-embedded token with the "bot" prefix', () => {
    const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
    expect(sanitizeError(`POST ${url} -> 401`)).toBe(
      'POST https://api.telegram.org/[redacted-token]/sendMessage -> 401',
    );
  });

  it('redacts multiple tokens in the same string', () => {
    const out = sanitizeError(`${TOKEN} and bot${TOKEN}`);
    expect(out).toBe('[redacted-token] and [redacted-token]');
    expect(out).not.toContain(AUTH_35);
  });

  it('redacts a token with a longer auth segment', () => {
    const longAuth = `${AUTH_35}EXTRAchars1234567890`;
    expect(sanitizeError(`boom ${1234567890}:${longAuth}`)).toBe('boom [redacted-token]');
  });

  it('leaves benign "key:value" pairs untouched', () => {
    expect(sanitizeError('timeout:30 retries:3 status:failed')).toBe(
      'timeout:30 retries:3 status:failed',
    );
  });

  it('does not redact a short numeric:string pair below token thresholds', () => {
    // 4-digit id and short suffix — clearly not a token.
    expect(sanitizeError('chat 4242:hello there')).toBe('chat 4242:hello there');
  });

  it('does not over-redact a long number followed by a short suffix', () => {
    // 8+ digit id but auth segment too short to be a token.
    expect(sanitizeError('id 12345678:abc')).toBe('id 12345678:abc');
  });

  it('returns the input unchanged when there is no token', () => {
    expect(sanitizeError('connection refused')).toBe('connection refused');
  });
});
