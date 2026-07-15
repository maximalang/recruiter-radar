import { validateWebhookUrl } from '../../../lib/notification-providers';

describe('notification webhook validation', () => {
  const previousNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: previousNodeEnv,
      configurable: true,
      enumerable: true,
      writable: true,
    });
  });

  function setNodeEnv(value: string) {
    Object.defineProperty(process.env, 'NODE_ENV', {
      value,
      configurable: true,
      enumerable: true,
      writable: true,
    });
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
    'https://service.internal/hook',
  ])('rejects production-local endpoint %s', (url) => {
    setNodeEnv('production');
    expect(() => validateWebhookUrl(url)).toThrow();
  });

  it('allows localhost HTTP only outside production', () => {
    setNodeEnv('test');
    expect(validateWebhookUrl('http://localhost:5678/webhook').hostname).toBe('localhost');
  });
});
