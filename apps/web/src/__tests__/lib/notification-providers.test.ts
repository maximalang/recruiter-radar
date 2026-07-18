import {
  classifyNotificationProviderError,
  sendSignedWebhook,
  sendTelegramNotification,
  validateWebhookUrl,
} from '../../../lib/notification-providers';

describe('notification webhook validation', () => {
  const previousNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = previousNodeEnv;
    jest.restoreAllMocks();
  });

  function setNodeEnv(value: string) {
    process.env.NODE_ENV = value;
  }

  it('accepts a public HTTPS endpoint', () => {
    setNodeEnv('production');
    expect(validateWebhookUrl('https://hooks.example.com/radar').hostname).toBe('hooks.example.com');
  });

  it('rejects credentials embedded in a webhook URL', () => {
    setNodeEnv('production');
    expect(() => validateWebhookUrl('https://user:secret@hooks.example.com/radar')).toThrow(
      'must not contain embedded credentials',
    );
  });

  it.each([
    'http://127.0.0.1:5678/webhook',
    'https://10.0.0.5/hook',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/hook',
    'https://[fd00::1]/hook',
    'https://[::ffff:169.254.169.254]/latest/meta-data',
    'https://service.internal/hook',
  ])('rejects production-local endpoint %s', (url) => {
    setNodeEnv('production');
    expect(() => validateWebhookUrl(url)).toThrow();
  });

  it('allows localhost HTTP only outside production', () => {
    setNodeEnv('test');
    expect(validateWebhookUrl('http://localhost:5678/webhook').hostname).toBe('localhost');
  });

  it('reads at most 2KB from a provider response', async () => {
    setNodeEnv('test');
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response('x'.repeat(10_000), { status: 200 }),
    );

    const result = await sendSignedWebhook({
      url: 'https://example.com/hook',
      secret: 'secret',
      event: 'digest.ready',
      eventId: 'evt_1',
      payload: { ok: true },
    });

    expect(result.responseText).toHaveLength(2_000);
  });
});

describe('Telegram provider error classification', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('preserves HTTP 429 and retry_after for the dispatcher', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error_code: 429,
          description: 'Too Many Requests',
          parameters: { retry_after: 17 },
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    let caught: unknown;
    try {
      await sendTelegramNotification({
        botToken: '123456:token',
        chatId: '42',
        text: 'test',
      });
    } catch (error) {
      caught = error;
    }

    expect(classifyNotificationProviderError(caught)).toEqual(
      expect.objectContaining({
        kind: 'rate_limited',
        status: 429,
        code: '429',
        retryAfterSeconds: 17,
      }),
    );
  });

  it('returns the provider message id on success', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { message_id: 987 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(
      sendTelegramNotification({ botToken: '123456:token', chatId: '42', text: 'test' }),
    ).resolves.toEqual({ providerMessageId: '987' });
  });
});
