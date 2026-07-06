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
import { formatSignalStrength } from "./scoring/score-display";

const BOM = "﻿";

type CsvColumn = {
  header: string;
  value: (lead: LeadItem) => string;
};

const COLUMNS: readonly CsvColumn[] = [
  { header: "Компания", value: (l) => l.orgName },
  { header: "Сила сигнала (0–4)", value: (l) => formatScore(l.score) },
  { header: "Уверенность", value: (l) => l.confidenceGate },
  { header: "Почему сейчас", value: (l) => l.whyNow },
  { header: "Безопасный контакт", value: (l) => l.lawfulContactPath ?? "" },
  { header: "Вакансий", value: (l) => String(l.vacanciesCount ?? 0) },
  { header: "Доказательства", value: (l) => l.evidenceTitles.join("; ") },
  { header: "Локации", value: (l) => l.locationNames.join("; ") },
  { header: "Источники", value: (l) => l.sourceFamilies.join("; ") },
  { header: "Статус", value: (l) => l.feedbackStatus ?? "" },
  { header: "Последний сигнал", value: (l) => l.latestPublishedAt ?? "" },
];

/**
 * Render the lead score for CSV. `score` is the raw persisted total_score
 * (~200–390); the shared score-display module converts it to the [0,4]
 * signal-strength scale so the export matches what the UI and cards show.
 */
function formatScore(score: number): string {
  return formatSignalStrength(score);
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
