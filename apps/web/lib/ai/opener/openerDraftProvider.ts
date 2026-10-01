/**
 * D3 draft-opener provider — the first in-app LLM call, routed through the
 * standard provider seam (lib/ai/providers/llm-config.ts): CodeXoid is the
 * configured OpenAI-compatible provider, OpenAI remains the fallback. NO new
 * paid provider is introduced (owner directive 2026-10-01); credentials come
 * only from the operator DB override / env via resolveLlm* — never hardcoded.
 *
 * Implements Hook 5 (`OpenerDraftHook`) of lib/ai/assist-types.ts:
 *   input  — orgName, reasons[], roleNames[], contactPolicy (facts only)
 *   output — AssistResult<{ draft }> plus generation provenance (model,
 *            traceId, tokensUsed, promptVersion) for the stored draft + audit.
 *
 * Boundary contract (lib/ai/boundary.ts):
 *   - capability 'draft-opener'; output is an editable suggestion, never a send.
 *   - 'invent-evidence': the prompt is fact-only and forbids inventing contacts,
 *     names, numbers, or company details beyond the passed facts.
 *   - 'bypass-contact-policy': contactPolicy is injected as a hard prompt rule.
 *   - 'auto-send': this module only returns text; there is no delivery path.
 *   - 'change-score'/'change-gate': nothing here touches scoring columns.
 *
 * Degradation: no API key, network failure, non-2xx, unparsable body, or empty
 * content all return `available: false` with a machine-readable note — the UI
 * then keeps the deterministic baseline. This function never throws.
 */

import { randomUUID } from 'crypto';

import type {
  AiAssistProvider,
  AssistResult,
  OpenerDraftInput,
  OpenerDraftOutput,
} from '../assist-types';
import {
  resolveLlmApiKey,
  resolveLlmProviderConfig,
} from '../providers/llm-config';
import { logOpenerDraftApiCall } from './openerDraftRateLimit';

/** Prompt contract version — persisted with every stored draft. */
export const OPENER_DRAFT_PROMPT_VERSION = 'opener-draft-v1';

/**
 * Product cap for a first-touch opener, matching the deterministic
 * `buildOpener` (lib/digest.ts) contract of <= 450 characters.
 */
export const MAX_OPENER_DRAFT_CHARS = 450;

/** Hard timeout for the chat-completions call (the UI waits synchronously). */
export const OPENER_DRAFT_TIMEOUT_MS = 20_000;

/** Input caps — facts are DB-sourced, but the prompt stays bounded anyway. */
const MAX_ORG_NAME_CHARS = 120;
const MAX_REASONS = 4;
const MAX_REASON_CHARS = 200;
const MAX_ROLE_NAMES = 6;
const MAX_ROLE_NAME_CHARS = 80;

/**
 * A generated draft plus the provenance the store and the audit log need.
 * Structurally extends OpenerDraftOutput, so it satisfies OpenerDraftHook.
 */
export interface GeneratedOpenerDraft extends OpenerDraftOutput {
  /** Model name the provider was called with. */
  model: string;
  /** Correlation id — stored on the draft and emitted in ai.opener.api_call. */
  traceId: string;
  /** Prompt contract version used for the generation. */
  promptVersion: string;
  /** Token usage reported by the provider, null when not reported. */
  tokensUsed: number | null;
}

/** Injectable seams for tests and the live dev-env evidence run. */
export interface OpenerDraftCallOptions {
  fetchImpl?: typeof fetch;
  /** Pre-assigned correlation id (tests / evidence scripts). */
  traceId?: string;
  /** Org id for the audit log line (cost attribution). */
  orgId?: string;
}

/** contactPolicy → the hard prompt rule (boundary: bypass-contact-policy). */
const CONTACT_POLICY_RULES: Record<OpenerDraftInput['contactPolicy'], string> = {
  corporate_only:
    'Политика контакта: только корпоративные каналы. Не упоминай личные контакты сотрудников (телефоны, личные почты, личные мессенджеры) и не предлагай их запросить.',
  no_personal:
    'Политика контакта: без персональных данных. Не упоминай и не запрашивай личные контакты конкретных сотрудников (телефоны, личные почты, мессенджеры).',
  unrestricted:
    'Специальных ограничений по контактам нет, но сохраняй деловой тон и не выдумывай контактные данные.',
};

/**
 * Build the system+user prompt for a generation. Exported for tests: the
 * fact-only contract and the contactPolicy rule are asserted on these strings.
 * All inputs are length-capped; the model is told to answer with the message
 * text only (no subject, no signature, no quotes).
 */
export function buildOpenerDraftPrompt(input: OpenerDraftInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  const orgName = input.orgName.trim().slice(0, MAX_ORG_NAME_CHARS) || 'компания';
  const policyRule = CONTACT_POLICY_RULES[input.contactPolicy] ?? CONTACT_POLICY_RULES.corporate_only;
  const reasons = input.reasons
    .slice(0, MAX_REASONS)
    .map((reason) => reason.trim().slice(0, MAX_REASON_CHARS))
    .filter((reason) => reason.length > 0);
  const roleNames = input.roleNames
    .slice(0, MAX_ROLE_NAMES)
    .map((role) => role.trim().slice(0, MAX_ROLE_NAME_CHARS))
    .filter((role) => role.length > 0);

  const systemPrompt =
    'Ты помогаешь рекрутинговому агентству написать первое короткое сообщение компании. ' +
    'Правила: используй ТОЛЬКО переданные факты (название компании, причины интереса, роли в подборе). ' +
    'Не выдумывай имена людей, контакты, цифры, вакансии, ссылки и любые другие факты о компании. ' +
    policyRule + ' ' +
    `Ответ: только текст сообщения на русском языке, не более ${MAX_OPENER_DRAFT_CHARS} символов, ` +
    'без темы письма, без подписи с контактными данными, без кавычек и без пояснений.';

  const userPrompt =
    `Компания: ${orgName}\n` +
    `Почему сейчас:\n${reasons.length > 0 ? reasons.map((reason) => `- ${reason}`).join('\n') : '- (не указано)'}\n` +
    `Роли в подборе: ${roleNames.length > 0 ? roleNames.join(', ') : 'не определены'}`;

  return { systemPrompt, userPrompt };
}

function unavailable(
  provider: string,
  note: string,
): AssistResult<GeneratedOpenerDraft> {
  return {
    available: false,
    capability: 'draft-opener',
    provider,
    confidence: 'low',
    data: null,
    note,
  };
}

/** Strip one layer of full-string wrapping quotes some models add. */
function unwrapQuoted(text: string): string {
  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ['«', '»'],
    ['“', '”'],
    ["'", "'"],
  ];
  for (const [open, close] of pairs) {
    if (text.length >= 2 && text.startsWith(open) && text.endsWith(close)) {
      return text.slice(1, -1).trim();
    }
  }
  return text;
}

/** Word-safe cap to MAX_OPENER_DRAFT_CHARS (matches the deterministic limit). */
export function capOpenerDraftText(text: string, max: number = MAX_OPENER_DRAFT_CHARS): string {
  const trimmed = unwrapQuoted(text.trim());
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > Math.floor(max * 0.6) ? cut.slice(0, lastSpace) : cut;
  return `${base.replace(/[\s,;:.—-]+$/, '')}…`;
}

/** choices[0].message.content when it is a plain string, else null. */
function extractContent(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0] as { message?: { content?: unknown } };
  const content = first?.message?.content;
  return typeof content === 'string' ? content : null;
}

/** usage.total_tokens when reported, else null. */
function extractTokensUsed(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const usage = (payload as { usage?: { total_tokens?: unknown } }).usage;
  const total = usage?.total_tokens;
  return typeof total === 'number' && Number.isFinite(total) ? total : null;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

/**
 * Generate an editable opener draft from lead facts via the configured
 * OpenAI-compatible provider. Exactly ONE network call (chat/completions) per
 * invocation; on any failure it degrades to `available: false` and never
 * throws. The caller (server action) owns auth, quota, and persistence.
 */
export async function draftOpener(
  input: OpenerDraftInput,
  options: OpenerDraftCallOptions = {},
): Promise<AssistResult<GeneratedOpenerDraft>> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const config = resolveLlmProviderConfig();
  const orgId = options.orgId ?? 'unknown';
  const traceId = options.traceId ?? randomUUID();

  const apiKey = resolveLlmApiKey();
  if (!apiKey || typeof fetchImpl !== 'function') {
    logOpenerDraftApiCall({ orgId, provider: config.provider, model: config.model, traceId, success: false });
    return unavailable(config.provider, 'llm_not_configured');
  }

  const { systemPrompt, userPrompt } = buildOpenerDraftPrompt(input);

  let response: Response;
  try {
    response = await fetchImpl(`${normalizeBaseUrl(config.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.4,
        max_tokens: 400,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: AbortSignal.timeout(OPENER_DRAFT_TIMEOUT_MS),
    });
  } catch {
    logOpenerDraftApiCall({ orgId, provider: config.provider, model: config.model, traceId, success: false });
    return unavailable(config.provider, 'llm_request_failed');
  }

  if (!response.ok) {
    logOpenerDraftApiCall({ orgId, provider: config.provider, model: config.model, traceId, success: false });
    return unavailable(config.provider, `llm_http_${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    logOpenerDraftApiCall({ orgId, provider: config.provider, model: config.model, traceId, success: false });
    return unavailable(config.provider, 'llm_bad_response');
  }

  const content = extractContent(payload);
  const tokensUsed = extractTokensUsed(payload);
  const draft = content ? capOpenerDraftText(content) : '';
  if (!draft) {
    logOpenerDraftApiCall({ orgId, provider: config.provider, model: config.model, traceId, success: false, tokensUsed });
    return unavailable(config.provider, 'llm_empty_draft');
  }

  logOpenerDraftApiCall({ orgId, provider: config.provider, model: config.model, traceId, success: true, tokensUsed });
  return {
    available: true,
    capability: 'draft-opener',
    provider: config.provider,
    // Self-assessment only (assist-types.ts): a draft is a suggestion, never a
    // gate input. 'medium' is the honest constant for fact-bounded copy.
    confidence: 'medium',
    data: {
      draft,
      model: config.model,
      traceId,
      promptVersion: OPENER_DRAFT_PROMPT_VERSION,
      tokensUsed,
    },
  };
}

/**
 * The draft-opener as a registered assist provider (assist-types.ts registry).
 * Satisfies OpenerDraftHook structurally: GeneratedOpenerDraft extends
 * OpenerDraftOutput.
 */
export const openerDraftProvider: AiAssistProvider = {
  name: 'llm-opener-draft',
  draftOpener: (input) => draftOpener(input),
};
