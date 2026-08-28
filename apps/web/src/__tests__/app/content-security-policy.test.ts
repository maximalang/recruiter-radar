import { buildContentSecurityPolicy } from '../../../next.config';

describe('Content Security Policy', () => {
  it('allows the Next.js bootstrap inline scripts and Yandex Metrika endpoints without production eval', () => {
    const policy = buildContentSecurityPolicy('production');

    expect(policy).toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).toContain("https://mc.yandex.ru");
    expect(policy).toContain("https://mc.yandex.com");
    expect(policy).toContain("wss://mc.yandex.ru");
    expect(policy).toContain("wss://mc.yandex.com");
    expect(policy).toContain(`frame-src https://mc.yandex.ru https://mc.yandex.com`);
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain(' ws:');
  });

  it('keeps eval and generic websocket access limited to development tooling', () => {
    const policy = buildContentSecurityPolicy('development');

    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("connect-src 'self' ws:");
  });
});
