/**
 * Tests for the OpenAI-compatible LLM provider config (CodeXoid / OpenAI).
 *
 * What is under test:
 *   - resolveLlmApiKey reads OPENAI_API_KEY only; never hardcoded.
 *   - resolveLlmBaseUrl defaults to OpenAI; switches to CodeXoid via env.
 *   - resolveLlmModel precedence: explicit > CODEXOID_MODEL > FIRECRAWL_LLM_MODEL > gpt-4o-mini.
 *   - isCodeXoidProvider reflects the base URL host, not a secret.
 *   - resolveLlmProviderConfig never includes the API key (no leak in logs).
 *   - Backward compatibility: with no CodeXoid env, the config resolves to OpenAI.
 */

import {
  resolveLlmApiKey,
  resolveLlmBaseUrl,
  resolveLlmModel,
  resolveLlmProviderConfig,
  isLlmConfigured,
  isCodeXoidProvider,
} from '@/lib/ai/providers/llm-config';

const ORIG = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  CODEXOID_MODEL: process.env.CODEXOID_MODEL,
  FIRECRAWL_LLM_MODEL: process.env.FIRECRAWL_LLM_MODEL,
};

afterEach(() => {
  for (const k of Object.keys(ORIG) as Array<keyof typeof ORIG>) {
    if (ORIG[k] === undefined) delete process.env[k];
    else process.env[k] = ORIG[k];
  }
});

describe('resolveLlmApiKey', () => {
  it('returns null when OPENAI_API_KEY is unset', () => {
    delete process.env.OPENAI_API_KEY;
    expect(resolveLlmApiKey()).toBeNull();
  });

  it('reads OPENAI_API_KEY from env (never hardcoded)', () => {
    delete process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test-123';
    expect(resolveLlmApiKey()).toBe('sk-test-123');
  });

  it('explicit arg takes precedence over env', () => {
    process.env.OPENAI_API_KEY = 'sk-env';
    expect(resolveLlmApiKey('sk-explicit')).toBe('sk-explicit');
  });
});

describe('resolveLlmBaseUrl', () => {
  it('defaults to OpenAI when unset (backward compatibility)', () => {
    delete process.env.OPENAI_BASE_URL;
    expect(resolveLlmBaseUrl()).toBe('https://api.openai.com/v1');
  });

  it('switches to CodeXoid when OPENAI_BASE_URL points at it', () => {
    process.env.OPENAI_BASE_URL = 'https://codexoid.duckdns.org/v1';
    expect(resolveLlmBaseUrl()).toBe('https://codexoid.duckdns.org/v1');
  });

  it('explicit arg takes precedence', () => {
    process.env.OPENAI_BASE_URL = 'https://codexoid.duckdns.org/v1';
    expect(resolveLlmBaseUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1');
  });
});

describe('resolveLlmModel', () => {
  it('defaults to gpt-4o-mini when nothing is set', () => {
    delete process.env.CODEXOID_MODEL;
    delete process.env.FIRECRAWL_LLM_MODEL;
    expect(resolveLlmModel()).toBe('gpt-4o-mini');
  });

  it('uses CODEXOID_MODEL when set (CodeXoid path)', () => {
    delete process.env.FIRECRAWL_LLM_MODEL;
    process.env.CODEXOID_MODEL = 'codexoid/kr/claude-opus-4.8';
    expect(resolveLlmModel()).toBe('codexoid/kr/claude-opus-4.8');
  });

  it('CODEXOID_MODEL takes precedence over FIRECRAWL_LLM_MODEL', () => {
    process.env.FIRECRAWL_LLM_MODEL = 'gpt-4o-mini';
    process.env.CODEXOID_MODEL = 'codexoid/kr/claude-opus-4.8';
    expect(resolveLlmModel()).toBe('codexoid/kr/claude-opus-4.8');
  });

  it('falls back to FIRECRAWL_LLM_MODEL when CODEXOID_MODEL unset', () => {
    delete process.env.CODEXOID_MODEL;
    process.env.FIRECRAWL_LLM_MODEL = 'gpt-4o';
    expect(resolveLlmModel()).toBe('gpt-4o');
  });

  it('explicit arg takes precedence over all env', () => {
    process.env.CODEXOID_MODEL = 'codexoid/kr/claude-opus-4.8';
    expect(resolveLlmModel('gpt-4o-mini')).toBe('gpt-4o-mini');
  });
});

describe('isCodeXoidProvider', () => {
  it('true when OPENAI_BASE_URL contains codexoid', () => {
    process.env.OPENAI_BASE_URL = 'https://codexoid.duckdns.org/v1';
    expect(isCodeXoidProvider()).toBe(true);
  });

  it('false for the OpenAI default', () => {
    delete process.env.OPENAI_BASE_URL;
    expect(isCodeXoidProvider()).toBe(false);
  });
});

describe('isLlmConfigured', () => {
  it('reflects OPENAI_API_KEY presence', () => {
    delete process.env.OPENAI_API_KEY;
    expect(isLlmConfigured()).toBe(false);
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(isLlmConfigured()).toBe(true);
  });
});

describe('resolveLlmProviderConfig', () => {
  it('resolves to CodeXoid when OPENAI_BASE_URL + CODEXOID_MODEL are set', () => {
    delete process.env.OPENAI_API_KEY;
    process.env.OPENAI_BASE_URL = 'https://codexoid.duckdns.org/v1';
    process.env.CODEXOID_MODEL = 'codexoid/kr/claude-opus-4.8';
    const cfg = resolveLlmProviderConfig();
    expect(cfg.provider).toBe('codexoid');
    expect(cfg.baseUrl).toBe('https://codexoid.duckdns.org/v1');
    expect(cfg.model).toBe('codexoid/kr/claude-opus-4.8');
    expect(cfg.configured).toBe(false);
  });

  it('resolves to OpenAI by default (backward compatibility)', () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.CODEXOID_MODEL;
    delete process.env.FIRECRAWL_LLM_MODEL;
    const cfg = resolveLlmProviderConfig();
    expect(cfg.provider).toBe('openai');
    expect(cfg.baseUrl).toBe('https://api.openai.com/v1');
    expect(cfg.model).toBe('gpt-4o-mini');
  });

  it('never exposes the API key (no leak in logs)', () => {
    process.env.OPENAI_API_KEY = 'sk-super-secret';
    process.env.OPENAI_BASE_URL = 'https://codexoid.duckdns.org/v1';
    process.env.CODEXOID_MODEL = 'codexoid/kr/claude-opus-4.8';
    const cfg = resolveLlmProviderConfig();
    expect(cfg.configured).toBe(true);
    // The config snapshot must not carry the secret value under any key.
    const values = Object.values(cfg);
    expect(values.some((v) => String(v).includes('sk-super-secret'))).toBe(false);
  });

  it('marks configured=true only when an API key is present', () => {
    delete process.env.OPENAI_API_KEY;
    process.env.OPENAI_BASE_URL = 'https://codexoid.duckdns.org/v1';
    process.env.CODEXOID_MODEL = 'codexoid/kr/claude-opus-4.8';
    expect(resolveLlmProviderConfig().configured).toBe(false);
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(resolveLlmProviderConfig().configured).toBe(true);
  });
});
