/**
 * Lead → CSV serialization for the lightweight "Экспорт CSV" delivery path.
 *
 * RFC 4180: fields containing comma, quote, CR or LF are wrapped in double
 * quotes and embedded quotes are doubled. We prepend a UTF-8 BOM so Excel on
 * Windows opens Cyrillic correctly. This is a pure, dependency-free function so
 * it is fully unit-testable without a route or a database.
 *
 * Columns mirror the evidence-first lead card — an exported row answers the same
 * questions a Telegram card does: who, score, confidence, why now, evidence,
 * safe contact path, sources — so a CSV handed to a CRM keeps the story intact.
 */

import type { LeadItem } from "./leads-data";
import { formatScorePoints } from "./scoring/score-display";
import { formatLawfulContactPath } from "./leads-data";

const BOM = "﻿";

/**
 * Review-status labels for CSV export. Mirrors the in-app REVIEW_LABELS
 * vocabulary so an exported row says "На проверке" / "Проверен" / "Отклонён"
 * exactly as the UI does. auto_approved → empty (no review needed = no value).
 */
const REVIEW_CSV_LABELS: Record<string, string> = {
  pending_review: "На проверке",
  approved: "Проверен",
  rejected: "Отклонён",
};

type CsvColumn = {
  header: string;
  value: (lead: LeadItem) => string;
};

const COLUMNS: readonly CsvColumn[] = [
  { header: "ID лида", value: (l) => l.id },
  { header: "Практика", value: (l) => l.profileName ?? "" },
  { header: "Компания", value: (l) => l.orgName },
  { header: "ИНН", value: (l) => l.orgInn ?? "" },
  { header: "ОГРН", value: (l) => l.orgOgrn ?? "" },
  { header: "Домен", value: (l) => l.orgDomain ?? "" },
  { header: "Карьерная страница", value: (l) => l.careerPageUrl ?? "" },
  { header: "Сила сигнала (0–100)", value: (l) => formatScore(l.score) },
  { header: "Уверенность", value: (l) => l.confidenceGate },
  { header: "Почему сейчас", value: (l) => l.whyNow },
  { header: "Безопасный контакт", value: (l) => formatLawfulContactPath(l.lawfulContactPath) ?? l.lawfulContactPath ?? "" },
  { header: "Вакансий", value: (l) => String(l.vacanciesCount ?? 0) },
  { header: "Доказательства", value: (l) => l.evidenceTitles.join("; ") },
  { header: "Локации", value: (l) => l.locationNames.join("; ") },
  { header: "Источники", value: (l) => l.sourceFamilies.join("; ") },
  { header: "Статус", value: (l) => l.feedbackStatus ?? "" },
  { header: "Проверка", value: (l) => REVIEW_CSV_LABELS[l.reviewStatus ?? ""] ?? l.reviewStatus ?? "" },
  { header: "Последний сигнал", value: (l) => l.latestPublishedAt ?? "" },
];

/**
 * Render the lead score for CSV. `score` is the raw persisted total_score
 * (~200–400); the shared score-display module converts it to the 0–100
 * points scale so the export matches what the UI and cards show.
 */
function formatScore(score: number): string {
  return formatScorePoints(score);
}

/** Quote a single CSV field per RFC 4180 when it contains a special character. */
function escapeField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toRow(cells: readonly string[]): string {
  return cells.map(escapeField).join(",");
}

/**
 * Serialize leads to a CSV document (with header row and UTF-8 BOM).
 * Empty input still yields the header row so the file is always well-formed.
 */
export function leadsToCsv(leads: readonly LeadItem[]): string {
  const lines: string[] = [];
  lines.push(toRow(COLUMNS.map((c) => c.header)));
  for (const lead of leads) {
    lines.push(toRow(COLUMNS.map((c) => c.value(lead))));
  }
  // CRLF line endings — the RFC 4180 default and what Excel expects.
  return BOM + lines.join("\r\n");
}

/** Column count, exposed for tests asserting row/column integrity. */
export const LEADS_CSV_COLUMN_COUNT = COLUMNS.length;

// ─── CRM handoff block (single lead, plain text) ─────────────────

/**
 * Input shape for the CRM handoff block. A superset of the list LeadItem's
 * CRM-identifier optional fields plus the detail-only org fields. Kept loose
 * (all optional except the identity/score fields the block always shows) so it
 * accepts both a list LeadItem (with includeOrgDetails fields) and a full
 * LeadDetail without forcing the caller to adapt.
 */
export interface CrmBlockLead {
  /** Lead id — included in the CSV row (ID лида column). Optional for the
   * plain-text CRM block (which doesn't show it) but required for the CSV row. */
  id?: string;
  orgName: string;
  score: number;
  confidenceGate: string;
  whyNow: string;
  lawfulContactPath: string | null;
  vacanciesCount: number;
  evidenceTitles: string[];
  locationNames: string[];
  sourceFamilies: string[];
  feedbackStatus: string | null;
  latestPublishedAt: string | null;
  orgInn?: string | null;
  orgOgrn?: string | null;
  orgDomain?: string | null;
  orgWebsite?: string | null;
  careerPageUrl?: string | null;
  profileName?: string | null;
  /** Analyst-review gate status (auto_approved/pending_review/approved/rejected). */
  reviewStatus?: string | null;
}

/**
 * Build a structured, human-readable plain-text block for pasting a single
 * lead into a CRM note, a team chat, or an email. Pure function — no I/O — so
 * it is fully unit-testable. Only renders fields that are present; absent
 * identifiers are omitted rather than emitted as empty "ИНН: " lines.
 *
 * The block mirrors the evidence-first lead card: who, score, confidence, why
 * now, safe contact, identifiers, evidence, sources — so a pasted note keeps
 * the story intact without inventing facts.
 */
export function leadToCrmBlock(lead: CrmBlockLead): string {
  const lines: string[] = [];
  lines.push(`Компания: ${lead.orgName}`);
  if (lead.profileName) lines.push(`Практика: ${lead.profileName}`);
  lines.push(`Сила сигнала: ${formatScorePoints(lead.score)} / 100 (уверенность ${lead.confidenceGate})`);
  if (lead.whyNow && lead.whyNow.trim()) lines.push(`Почему сейчас: ${lead.whyNow.trim()}`);
  const contact = formatLawfulContactPath(lead.lawfulContactPath) ?? lead.lawfulContactPath;
  if (contact) lines.push(`Безопасный контакт: ${contact}`);
  if (lead.orgDomain) lines.push(`Домен: ${lead.orgDomain}`);
  if (lead.orgWebsite) lines.push(`Сайт: ${lead.orgWebsite}`);
  if (lead.careerPageUrl) lines.push(`Карьерная страница: ${lead.careerPageUrl}`);
  if (lead.orgInn) lines.push(`ИНН: ${lead.orgInn}`);
  if (lead.orgOgrn) lines.push(`ОГРН: ${lead.orgOgrn}`);
  if (lead.locationNames.length > 0) lines.push(`Локации: ${lead.locationNames.join(", ")}`);
  if (lead.vacanciesCount > 0) lines.push(`Вакансий: ${lead.vacanciesCount}`);
  if (lead.evidenceTitles.length > 0) lines.push(`Доказательства: ${lead.evidenceTitles.join("; ")}`);
  if (lead.sourceFamilies.length > 0) lines.push(`Источники: ${lead.sourceFamilies.join(", ")}`);
  if (lead.feedbackStatus && lead.feedbackStatus !== "none") {
    lines.push(`Статус: ${lead.feedbackStatus}`);
  }
  if (lead.reviewStatus && lead.reviewStatus !== "auto_approved") {
    const reviewLabel = REVIEW_CSV_LABELS[lead.reviewStatus] ?? lead.reviewStatus;
    lines.push(`Проверка: ${reviewLabel}`);
  }
  if (lead.latestPublishedAt) {
    lines.push(`Последний сигнал: ${lead.latestPublishedAt}`);
  }
  return lines.join("\n");
}

/**
 * Serialize a SINGLE lead to a one-row CSV document (with header + UTF-8 BOM).
 * Used by the lead-detail "Экспорт этого лида" action for a quick handoff that
 * doesn't pull the whole list. Same column layout as the list export so a CRM
 * import mapping set up once works for both.
 */
export function singleLeadToCsv(lead: CrmBlockLead): string {
  // Cast: singleLeadToCsv shares the list serializer's column contract; the
  // CrmBlockLead shape is compatible with the Column value functions which read
  // the optional CRM fields off the LeadItem superset.
  return leadsToCsv([lead as unknown as LeadItem]);
}

