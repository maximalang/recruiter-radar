import {
  buildTelegramDeliveryReplyMarkup,
  notificationRetryDelaySeconds,
} from '../../../lib/notification-dispatch';
import { classifyNotificationProviderError } from '../../../lib/notification-providers';

describe('custom Telegram delivery controls', () => {
  const callbackSecret = ['telegram', 'feedback', 'test', 'secret'].join('-');

  beforeEach(() => {
    process.env.DIGEST_CALLBACK_SECRET = callbackSecret;
  });

  afterEach(() => {
    delete process.env.DIGEST_CALLBACK_SECRET;
  });

  it('adds signed controls only to private-chat endpoints', () => {
    const input = {
      clientProfileId: '7',
      leads: [{ orgId: '42', orgName: 'ООО «Пример»' }],
    };

    expect(buildTelegramDeliveryReplyMarkup({ endpointType: 'telegram_private_chat', ...input })).not.toBeNull();
    expect(buildTelegramDeliveryReplyMarkup({ endpointType: 'telegram_group', ...input })).toBeNull();
    expect(buildTelegramDeliveryReplyMarkup({ endpointType: 'telegram_channel', ...input })).toBeNull();
  });
});

describe('notification retry policy', () => {
  it.each([
    [1, 30],
    [2, 300],
    [3, 1_800],
    [4, 10_800],
  ])('uses exponential retry delay for attempt %s', (attemptNo, expected) => {
    expect(
      notificationRetryDelaySeconds(attemptNo, { kind: 'retryable' }),
    ).toBe(expected);
  });

  it('respects provider retry_after for rate limiting', () => {
    expect(
      notificationRetryDelaySeconds(2, {
        kind: 'rate_limited',
        retryAfterSeconds: 77,
      }),
    ).toBe(77);
  });

  it('clamps unsafe rate-limit delays', () => {
    expect(
      notificationRetryDelaySeconds(1, {
        kind: 'rate_limited',
        retryAfterSeconds: 1,
      }),
    ).toBe(15);
    expect(
      notificationRetryDelaySeconds(1, {
        kind: 'rate_limited',
        retryAfterSeconds: 99_999,
      }),
    ).toBe(10_800);
  });

  it.each(['auth', 'permanent'] as const)('does not retry %s errors', (kind) => {
    expect(notificationRetryDelaySeconds(1, { kind })).toBeNull();
  });

  it('moves the fifth failed attempt to dead-letter', () => {
    expect(notificationRetryDelaySeconds(5, { kind: 'retryable' })).toBeNull();
  });

  it('treats a transport error without an HTTP response as ambiguous and terminal', () => {
    const classified = classifyNotificationProviderError(new Error('socket closed'));

    expect(classified.kind).toBe('ambiguous');
    expect(notificationRetryDelaySeconds(1, classified)).toBeNull();
  });

  it('treats HTTP 5xx as ambiguous because the provider may have committed', () => {
    const error = Object.assign(new Error('upstream failed after request'), { status: 503 });
    const classified = classifyNotificationProviderError(error);

    expect(classified.kind).toBe('ambiguous');
    expect(notificationRetryDelaySeconds(1, classified)).toBeNull();
  });
});
