/**
 * Outreach template system for lead contact messages.
 *
 * Provides variable substitution, built-in templates (Russian, premium tone),
 * and length limits for Telegram-friendly messages.
 */

// ─── Types ──────────────────────────────────────────────────────

export interface OutreachContext {
  orgName: string;
  reasons: string[];
  vacancyCount: number;
  roleNames: string[];
  sourceFamily: string;
  locationName: string;
  confidenceGate: string;
}

export interface OutreachTemplate {
  id: string;
  label: string;
  body: string;
}

// ─── Constants ──────────────────────────────────────────────────

/** Maximum outreach message length (Telegram-friendly) */
export const MAX_OUTREACH_LENGTH = 500;

// ─── Built-in Templates ─────────────────────────────────────────

export const OUTREACH_TEMPLATES: readonly OutreachTemplate[] = [
  {
    id: 'standard',
    label: 'Стандартное',
    body:
      'Здравствуйте! По {{orgName}} видно, что {{reasons}}. ' +
      'Предлагаю короткий созвон на 10-15 минут, чтобы сверить задачи по найму и понять, можем ли быть полезны. ' +
      'Если сейчас неактуально, просто дайте знать.',
  },
  {
    id: 'short',
    label: 'Короткое',
    body:
      'Здравствуйте! {{orgName}} — {{reasons}}. ' +
      'Есть 10 минут на созвон, чтобы обсудить, как можем помочь с наймом?',
  },
  {
    id: 'direct',
    label: 'Прямое (по роли)',
    body:
      'Здравствуйте! Вижу, что {{orgName}} ищет {{roleNames}}. ' +
      'У нас есть релевантные кандидаты в {{locationName}}. ' +
      'Предлагаю короткий созвон, чтобы понять, можем ли помочь. Если неактуально — дайте знать.',
  },
] as const;

// ─── Rendering ──────────────────────────────────────────────────

/**
 * Render an outreach template with context variables.
 *
 * Supported variables:
 * - {{orgName}} — company display name
 * - {{reasons}} — comma-separated list of match reasons
 * - {{vacancyCount}} — number of active vacancies
 * - {{roleNames}} — comma-separated list of role names
 * - {{locationName}} — primary location
 * - {{sourceFamily}} — source family (e.g., 'hh')
 * - {{confidenceGate}} — confidence gate letter (A/B/C/D)
 */
export function renderOutreachTemplate(
  template: OutreachTemplate,
  context: OutreachContext,
): string {
  const vars: Record<string, string> = {
    orgName: context.orgName,
    reasons: context.reasons.join(', '),
    vacancyCount: String(context.vacancyCount),
    roleNames: context.roleNames.join(', '),
    locationName: context.locationName,
    sourceFamily: context.sourceFamily,
    confidenceGate: context.confidenceGate,
  };

  let result = template.body;

  for (const [key, value] of Object.entries(vars)) {
    const placeholder = `{{${key}}}`;
    result = result.replaceAll(placeholder, value);
  }

  // Truncate if exceeds max length, preferring sentence boundary
  if (result.length > MAX_OUTREACH_LENGTH) {
    const truncated = result.slice(0, MAX_OUTREACH_LENGTH);
    // Try to break at last sentence end (. ! ?) within limit
    const lastSentenceEnd = Math.max(
      truncated.lastIndexOf('. '),
      truncated.lastIndexOf('! '),
      truncated.lastIndexOf('? '),
    );
    if (lastSentenceEnd > MAX_OUTREACH_LENGTH * 0.5) {
      result = truncated.slice(0, lastSentenceEnd + 1);
    } else {
      // Reserve space for ellipsis
      result = result.slice(0, MAX_OUTREACH_LENGTH - 1) + '…';
    }
  }

  return result;
}
