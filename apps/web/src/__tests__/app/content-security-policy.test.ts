import { buildContentSecurityPolicy } from '../../../next.config';

describe('Content Security Policy', () => {
  it('allows the Next.js bootstrap inline scripts without production eval', () => {
    const policy = buildContentSecurityPolicy('production');

    expect(policy).toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).toContain("https://mc.yandex.ru");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain(' ws:');
  });

  it('keeps eval and websocket access limited to development tooling', () => {
    const policy = buildContentSecurityPolicy('development');

    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("connect-src 'self' ws:");
  });
});
