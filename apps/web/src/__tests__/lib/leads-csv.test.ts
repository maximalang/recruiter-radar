/**
 * Tests for leadsToCsv — the pure CSV serializer behind /api/leads/export.
 *
 * Pure function, no DB / no mocks. Covers RFC 4180 escaping, BOM, header
 * integrity, and the empty case.
 */

import { leadsToCsv, LEADS_CSV_COLUMN_COUNT } from '@/lib/leads-csv';
import type { LeadItem } from '@/lib/leads-data';

function makeLead(overrides: Partial<LeadItem> = {}): LeadItem {
  return {
    id: 'lead-1',
    orgId: 'org-1',
    orgName: 'Рога и Копыта',
    sourceExternalId: null,
    score: 3.2,
    confidenceGate: 'A',
    vacanciesCount: 4,
    distinctVacancyNamesCount: 2,
    latestPublishedAt: '2026-06-25',
    reasons: [],
    whyNow: 'Всплеск найма',
    bestAngle: 'Закрытие IT-ролей',
    lawfulContactPath: 'Карьерная страница',
    negativeSignals: [],
    opener: '',
    feedbackStatus: null,
    suppressedUntil: null,
    createdAt: '2026-06-25T10:00:00Z',
    sourceFamilies: ['career-pages'],
    evidenceTitles: ['Senior Java Developer'],
    locationNames: ['Москва'],
    ...overrides,
  };
}

const BOM = '﻿';

describe('leadsToCsv', () => {
  it('prepends a UTF-8 BOM', () => {
    const csv = leadsToCsv([]);
    expect(csv.startsWith(BOM)).toBe(true);
  });

  it('always emits the header row, even for empty input', () => {
    const csv = leadsToCsv([]);
    const firstLine = csv.slice(BOM.length).split('\r\n')[0];
    expect(firstLine.split(',')).toHaveLength(LEADS_CSV_COLUMN_COUNT);
    expect(firstLine).toContain('Компания');
  });

  it('uses CRLF line endings', () => {
    const csv = leadsToCsv([makeLead()]);
    expect(csv).toContain('\r\n');
    expect(csv.slice(BOM.length).split('\r\n')).toHaveLength(2); // header + 1 row
  });

  it('produces one data row per lead with the right column count', () => {
    const csv = leadsToCsv([makeLead(), makeLead({ id: 'lead-2' })]);
    const rows = csv.slice(BOM.length).split('\r\n');
    expect(rows).toHaveLength(3); // header + 2 rows
  });

  it('quotes fields containing commas', () => {
    const csv = leadsToCsv([makeLead({ orgName: 'ООО "Альфа", Москва' })]);
    expect(csv).toContain('"ООО ""Альфа"", Москва"');
  });

  it('quotes and doubles embedded quotes', () => {
    const csv = leadsToCsv([makeLead({ whyNow: 'Сказал «срочно» "сегодня"' })]);
    expect(csv).toContain('"Сказал «срочно» ""сегодня"""');
  });

  it('quotes fields containing newlines', () => {
    const csv = leadsToCsv([makeLead({ bestAngle: 'Строка 1\nСтрока 2' })]);
    expect(csv).toContain('"Строка 1\nСтрока 2"');
  });

  it('joins multi-value arrays with semicolons', () => {
    const csv = leadsToCsv([
      makeLead({
        evidenceTitles: ['Java Dev', 'Python Dev'],
        sourceFamilies: ['career-pages', 'habr'],
      }),
    ]);
    expect(csv).toContain('Java Dev; Python Dev');
    expect(csv).toContain('career-pages; habr');
  });

  it('converts the raw score to one-decimal signal strength', () => {
    const csv = leadsToCsv([makeLead({ score: 300 })]);
    const dataRow = csv.slice(BOM.length).split('\r\n')[1];
    expect(dataRow.split(',')[1]).toBe('3.0');
  });

  it('rounds the converted signal strength to one decimal place', () => {
    const csv = leadsToCsv([makeLead({ score: 275 })]);
    const dataRow = csv.slice(BOM.length).split('\r\n')[1];
    expect(dataRow.split(',')[1]).toBe('2.8');
  });

  it('renders null contact path and feedback as empty fields', () => {
    const csv = leadsToCsv([
      makeLead({ lawfulContactPath: null, feedbackStatus: null, latestPublishedAt: null }),
    ]);
    // Should not contain the literal string "null"
    expect(csv).not.toContain('null');
  });
});
