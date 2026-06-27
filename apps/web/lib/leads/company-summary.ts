/**
 * Deterministic company / hiring summary builder.
 *
 * Synthesizes — in three short, evidence-backed sentences — what is already
 * known about a lead: what the company appears to be, what hiring motion is
 * happening now, and why it matters to an agency. It NEVER invents facts: every
 * sentence is gated on a concrete field being present, and when evidence is weak
 * (low gate, single source, no roles) it deliberately says LESS rather than
 * padding.
 *
 * This is the deterministic baseline; a future AI layer (Stage 2 enrichment) may
 * add *attributed* context around it but may not fold AI text into evidence or
 * change the gate. Read-only over the deterministic core.
 *
 * docs/specs/2026-06-27-stage1-ai-assist-deterministic.md
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CompanySummaryInput {
  orgName: string;
  confidenceGate: string;
  vacanciesCount: number;
  distinctVacancyNamesCount: number;
  evidenceTitles: string[];
  sourceFamilies: string[];
  locationNames: string[];
  latestPublishedAt: string | null;
}

export type SummaryStrength = 'strong' | 'moderate' | 'weak';

export interface CompanySummary {
  /** What the company appears to be — only when location/source gives a basis. */
  identity: string | null;
  /** What hiring motion is happening — only when vacancy evidence exists. */
  hiringMotion: string | null;
  /** Why it matters to an agency — only when there is a real signal to act on. */
  agencyRelevance: string | null;
  /** Overall evidence strength; drives how much the UI leans on this block. */
  strength: SummaryStrength;
  /** True when evidence is too thin to say anything beyond identity. */
  isThin: boolean;
}

// ─── Builder ─────────────────────────────────────────────────────────────────

export function buildCompanySummary(lead: CompanySummaryInput): CompanySummary {
  const strength = classifyStrength(lead);

  const identity = buildIdentity(lead);
  const hiringMotion = buildHiringMotion(lead);
  // Agency relevance is only honest when there is an actual hiring signal AND the
  // evidence is not weak — otherwise we'd be overselling a thin lead.
  const agencyRelevance =
    hiringMotion && strength !== 'weak' ? buildAgencyRelevance(lead) : null;

  const isThin = hiringMotion === null;

  return { identity, hiringMotion, agencyRelevance, strength, isThin };
}

// ─── Sentence builders ───────────────────────────────────────────────────────

function buildIdentity(lead: CompanySummaryInput): string | null {
  const location = lead.locationNames[0];
  if (location) {
    return `${lead.orgName} — компания из региона ${location}.`;
  }
  // No location: only state the name if we at least know where the data came from.
  if (lead.sourceFamilies.length > 0) {
    return `${lead.orgName} — компания по данным источников (${lead.sourceFamilies.join(', ')}).`;
  }
  return null;
}

function buildHiringMotion(lead: CompanySummaryInput): string | null {
  // No vacancy evidence → no hiring claim. This is the core anti-hallucination
  // gate: we do not assert hiring without vacancy counts.
  if (lead.vacanciesCount <= 0) return null;

  const parts: string[] = [];
  if (lead.distinctVacancyNamesCount >= 3) {
    parts.push(
      `активно набирает: ${lead.vacanciesCount} вакансий по ${lead.distinctVacancyNamesCount} разным ролям`,
    );
  } else if (lead.vacanciesCount >= 3 && lead.distinctVacancyNamesCount <= 1) {
    // Many postings, one role — honest about the likely repost.
    parts.push(`${lead.vacanciesCount} вакансий по одной роли`);
  } else {
    const roleWord = lead.distinctVacancyNamesCount > 1 ? 'ролям' : 'роли';
    parts.push(
      `нанимает: ${lead.vacanciesCount} вакансий` +
        (lead.distinctVacancyNamesCount > 0
          ? ` по ${lead.distinctVacancyNamesCount} ${roleWord}`
          : ''),
    );
  }

  let sentence = `Сейчас ${parts.join('; ')}`;
  if (lead.latestPublishedAt) {
    const date = formatDate(lead.latestPublishedAt);
    if (date) sentence += `, последняя публикация ${date}`;
  }
  return sentence + '.';
}

function buildAgencyRelevance(lead: CompanySummaryInput): string | null {
  // Multi-source corroboration is the strongest "why it matters".
  if (lead.sourceFamilies.length >= 2) {
    return 'Несколько независимых источников подтверждают найм — это тёплый повод предложить услуги.';
  }
  if (lead.distinctVacancyNamesCount >= 3) {
    return 'Широкая потребность в найме — компания строит команду, есть что обсудить.';
  }
  return 'Есть активный сигнал найма — повод выйти на контакт сейчас.';
}

// ─── Strength classification ─────────────────────────────────────────────────

function classifyStrength(lead: CompanySummaryInput): SummaryStrength {
  const gate = lead.confidenceGate.toUpperCase();
  const multiSource = lead.sourceFamilies.length >= 2;
  const hasRoles = lead.distinctVacancyNamesCount > 0;

  if ((gate === 'A' || gate === 'B') && multiSource && hasRoles) return 'strong';
  if (gate === 'C' || gate === 'D' || !hasRoles) return 'weak';
  return 'moderate';
}

// ─── Internal ────────────────────────────────────────────────────────────────

function formatDate(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
