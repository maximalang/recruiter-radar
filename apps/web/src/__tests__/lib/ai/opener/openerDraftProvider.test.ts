/**
 * D3 draft-opener provider tests — the in-app LLM call behind the manual-send
 * opener draft (owner directive 2026-10-01).
 *
 * Contract under test:
 *   - exactly ONE network call per generation, to the OpenAI-compatible
 *     chat/completions endpoint resolved via lib/ai/providers/llm-config
 *     (CodeXoid configured provider / OpenAI fallback). There is NO send path:
 *     the only URL this module ever touches is chat/completions.
 *   - graceful degradation (available:false, never throws) on: missing API key,
 *     network failure, non-2xx, unparsable body, empty draft content.
 *   - the prompt is fact-only, embeds the contactPolicy rule (boundary:
 *     bypass-contact-policy), and caps the draft at the product limit.
 *   - every outcome emits the sanitized ai.opener.api_call audit line.
 */

import { logEvent } from '@/lib/runtime';
import {
  buildOpenerDraftPrompt,
  capOpenerDraftText,
  draftOpener,
  MAX_OPENER_DRAFT_CHARS,
  OPENER_DRAFT_PROMPT_VERSION,
} from '@/lib/ai/opener/openerDraftProvider';
import type { OpenerDraftInput } from '@/lib/ai/assist-types';
import { __resetLlmOverridesCacheForTests } from '@/lib/operatorSettings';

jest.mock('@/lib/runtime', () => ({
  logEvent: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

const mockLogEvent = jest.mocked(logEvent);

const ORIG = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  CODEXOID_MODEL: process.env.CODEXOID_MODEL,
  FIRECRAWL_LLM_MODEL: process.env.FIRECRAWL_LLM_MODEL,
};

function input(overrides: Partial<OpenerDraftInput> = {}): OpenerDraftInput {
  return {
    orgName: 'ООО Ромашка',
    reasons: ['У компании несколько активных вакансий одновременно'],
    roleNames: ['Backend-разработчик'],
    contactPolicy: 'corporate_only',
    ...overrides,
  };
}

function okResponse(content: string, tokensUsed?: number) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content } }],
      usage: tokensUsed === undefined ? undefined : { total_tokens: tokensUsed },
    }),
  } as unknown as Response;
}

const DRAFT_TEXT = 'Здравствуйте! По ООО Ромашка видно, что идёт активный найм. Предлагаю короткий созвон.';

let fetchImpl: jest.Mock;

beforeEach(() => {
  __resetLlmOverridesCacheForTests();
  jest.clearAllMocks();
  process.env.OPENAI_API_KEY = 'sk-test-secret';
  process.env.OPENAI_BASE_URL = 'https://codexoid.test/v1';
  process.env.CODEXOID_MODEL = 'codexoid/test-model';
  fetchImpl = jest.fn();
});

afterEach(() => {
  __resetLlmOverridesCacheForTests();
  for (const k of Object.keys(ORIG) as Array<keyof typeof ORIG>) {
    if (ORIG[k] === undefined) delete process.env[k];
    else process.env[k] = ORIG[k];
  }
});

describe('draftOpener — single provider call, no send path', () => {
  it('makes exactly one POST to <baseUrl>/chat/completions and returns the draft with provenance', async () => {
    fetchImpl.mockResolvedValue(okResponse(DRAFT_TEXT, 42));

    const result = await draftOpener(input(), { fetchImpl, traceId: 'trace-fixed', orgId: '9' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://codexoid.test/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer sk-test-secret');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('codexoid/test-model');
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
    expect(body.messages[1].content).toContain('ООО Ромашка');

    expect(result.available).toBe(true);
    expect(result.capability).toBe('draft-opener');
    expect(result.provider).toBe('codexoid');
    expect(result.confidence).toBe('medium');
    expect(result.data?.draft).toBe(DRAFT_TEXT);
    expect(result.data?.model).toBe('codexoid/test-model');
    expect(result.data?.traceId).toBe('trace-fixed');
    expect(result.data?.promptVersion).toBe(OPENER_DRAFT_PROMPT_VERSION);
    expect(result.data?.tokensUsed).toBe(42);

    // Sanitized audit line for the spend event.
    expect(mockLogEvent).toHaveBeenCalledWith(
      'ai.opener.api_call',
      expect.objectContaining({ provider: 'codexoid', model: 'codexoid/test-model', orgId: '9', traceId: 'trace-fixed', success: true, tokensUsed: 42 }),
    );
  });

  it('normalizes a trailing slash on the base URL', async () => {
    process.env.OPENAI_BASE_URL = 'https://codexoid.test/v1/';
    fetchImpl.mockResolvedValue(okResponse(DRAFT_TEXT));
    await draftOpener(input(), { fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://codexoid.test/v1/chat/completions');
  });

  it('attributes the openai fallback provider when the base URL is the OpenAI default', async () => {
    delete process.env.OPENAI_BASE_URL;
    delete process.env.CODEXOID_MODEL;
    fetchImpl.mockResolvedValue(okResponse(DRAFT_TEXT));
    const result = await draftOpener(input(), { fetchImpl });
    expect(result.provider).toBe('openai');
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.openai.com/v1/chat/completions');
  });
});

describe('draftOpener — graceful degradation (never throws)', () => {
  it('degrades without an API key and makes NO network call', async () => {
    delete process.env.OPENAI_API_KEY;
    const result = await draftOpener(input(), { fetchImpl });
    expect(result.available).toBe(false);
    expect(result.note).toBe('llm_not_configured');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mockLogEvent).toHaveBeenCalledWith('ai.opener.api_call', expect.objectContaining({ success: false }));
  });

  it('degrades on a network failure', async () => {
    fetchImpl.mockRejectedValue(new Error('socket hang up'));
    const result = await draftOpener(input(), { fetchImpl });
    expect(result.available).toBe(false);
    expect(result.note).toBe('llm_request_failed');
  });

  it('degrades on a non-2xx response', async () => {
    fetchImpl.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) } as unknown as Response);
    const result = await draftOpener(input(), { fetchImpl });
    expect(result.available).toBe(false);
    expect(result.note).toBe('llm_http_503');
  });

  it('degrades on an unparsable body', async () => {
    fetchImpl.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } } as unknown as Response);
    const result = await draftOpener(input(), { fetchImpl });
    expect(result.available).toBe(false);
    expect(result.note).toBe('llm_bad_response');
  });

  it('degrades when the provider returns empty content', async () => {
    fetchImpl.mockResolvedValue(okResponse('   '));
    const result = await draftOpener(input(), { fetchImpl });
    expect(result.available).toBe(false);
    expect(result.note).toBe('llm_empty_draft');
  });
});

describe('draftOpener — output validation', () => {
  it('caps an over-long draft at the product limit', async () => {
    const long = 'Слово '.repeat(200).trim(); // ~1200 chars
    expect(long.length).toBeGreaterThan(MAX_OPENER_DRAFT_CHARS);
    fetchImpl.mockResolvedValue(okResponse(long));
    const result = await draftOpener(input(), { fetchImpl });
    expect(result.available).toBe(true);
    expect(result.data!.draft.length).toBeLessThanOrEqual(MAX_OPENER_DRAFT_CHARS);
  });

  it('trims surrounding whitespace and unwraps full-string quotes', () => {
    expect(capOpenerDraftText('  «Текст»  ')).toBe('Текст');
    expect(capOpenerDraftText('"Текст"')).toBe('Текст');
    expect(capOpenerDraftText('  Текст  ')).toBe('Текст');
  });
});

describe('buildOpenerDraftPrompt — fact-only + contactPolicy', () => {
  it('embeds only the passed facts and forbids invention', () => {
    const { systemPrompt, userPrompt } = buildOpenerDraftPrompt(input({
      reasons: ['Роль опубликована недавно'],
      roleNames: ['QA-инженер', 'Backend-разработчик'],
    }));
    expect(systemPrompt).toContain('ТОЛЬКО переданные факты');
    expect(systemPrompt).toContain('Не выдумывай');
    expect(systemPrompt).toContain(String(MAX_OPENER_DRAFT_CHARS));
    expect(userPrompt).toContain('ООО Ромашка');
    expect(userPrompt).toContain('Роль опубликована недавно');
    expect(userPrompt).toContain('QA-инженер');
    expect(userPrompt).toContain('Backend-разработчик');
  });

  it('injects the corporate_only rule (no personal contacts)', () => {
    const { systemPrompt } = buildOpenerDraftPrompt(input({ contactPolicy: 'corporate_only' }));
    expect(systemPrompt).toContain('только корпоративные каналы');
    expect(systemPrompt).toContain('личные');
  });

  it('injects the no_personal rule', () => {
    const { systemPrompt } = buildOpenerDraftPrompt(input({ contactPolicy: 'no_personal' }));
    expect(systemPrompt).toContain('без персональных данных');
  });

  it('keeps a business tone for unrestricted without inventing contacts', () => {
    const { systemPrompt } = buildOpenerDraftPrompt(input({ contactPolicy: 'unrestricted' }));
    expect(systemPrompt).toContain('деловой тон');
    expect(systemPrompt).toContain('не выдумывай контактные данные');
  });

  it('bounds oversized inputs (prompt-injection surface stays capped)', () => {
    const { userPrompt } = buildOpenerDraftPrompt(input({
      orgName: 'X'.repeat(500),
      reasons: Array.from({ length: 20 }, (_, i) => `reason-${i} ${'y'.repeat(500)}`),
      roleNames: Array.from({ length: 20 }, (_, i) => `role-${i} ${'z'.repeat(300)}`),
    }));
    expect(userPrompt.length).toBeLessThan(3000);
  });
});
