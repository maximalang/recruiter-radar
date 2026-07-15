import { notificationRetryDelaySeconds } from '../../../lib/notification-dispatch';

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
});
