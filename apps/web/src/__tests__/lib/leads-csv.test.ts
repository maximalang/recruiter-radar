/**
 * Tests for leadsToCsv — the pure CSV serializer behind /api/leads/export.
 *
 * Pure function, no DB / no mocks. Covers RFC 4180 escaping, BOM, header
 * integrity, and the empty case.
 */

import { leadsToCsv, LEADS_CSV_COLUMN_COUNT, leadToCrmBlock, singleLeadToCsv } from '@/lib/leads-csv';
import type { LeadItem } from '@/lib/leads-data';

function makeLead(overrides: Partial<LeadItem> = {}): LeadItem {
  return {
    id: 'lead-1',
    orgId: 'org-1',
    clientProfileId: 'profile-1',
    orgName: 'Рога и Копыта',
    sourceExternalId: null,
    score: 3.2,
    confidenceGate: 'A',
    vacanciesCount: 4,
    distinctVacancyNamesCount: 2,
    latestPublishedAt: '2026-06-25',
    reasons: [],
    structuredReasons: [],
    whyNow: 'Всплеск найма',
    lawfulContactPath: 'Карьерная страница',
    negativeSignals: [],
    opener: '',
    feedbackStatus: null,
    suppressedUntil: null,
    createdAt: '2026-06-25T10:00:00Z',
    sourceFamilies: ['career-pages'],
    evidenceTitles: ['Senior Java Developer'],
    locationNames: ['Москва'],
    hasAiHint: false,
    isForeignEmployer: false,
    foreignMatchedDomain: null,
    contactPaths: [],
    reviewStatus: 'auto_approved',
    // CRM identifiers (optional on LeadItem; populated by the export path's
    // includeOrgDetails join). Default to populated values so the identifier-
    // column tests have something to assert against.
    orgInn: '7701234567',
    orgOgrn: '1027700123456',
    orgDomain: 'example.com',
    careerPageUrl: 'https://example.com/careers',
    profileName: 'IT-подбор',
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
    const csv = leadsToCsv([makeLead({ whyNow: 'Строка 1\nСтрока 2' })]);
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

  it('converts the raw score to a 0–100 score-points integer', () => {
    const csv = leadsToCsv([makeLead({ score: 300 })]);
    const dataRow = csv.slice(BOM.length).split('\r\n')[1];
    // "Сила сигнала (0–100)" is the 8th column (index 7) after the CRM
    // identifier columns: ID, Практика, Компания, ИНН, ОГРН, Домен, Карьерная.
    // raw 300 → scorePoints 75 (raw/4, rounded).
    expect(dataRow.split(',')[7]).toBe('75');
  });

  it('rounds the 0–100 score points to a whole number', () => {
    const csv = leadsToCsv([makeLead({ score: 275 })]);
    const dataRow = csv.slice(BOM.length).split('\r\n')[1];
    // raw 275 → 275/4 = 68.75 → rounded to 69.
    expect(dataRow.split(',')[7]).toBe('69');
  });

  it('renders null contact path and feedback as empty fields', () => {
    const csv = leadsToCsv([
      makeLead({ lawfulContactPath: null, feedbackStatus: null, latestPublishedAt: null }),
    ]);
    // Should not contain the literal string "null"
    expect(csv).not.toContain('null');
  });

  it('emits the CRM identifier columns (ID, Практика, ИНН, ОГРН, Домен, Карьерная)', () => {
    const csv = leadsToCsv([makeLead()]);
    const header = csv.slice(BOM.length).split('\r\n')[0];
    expect(header).toContain('ID лида');
    expect(header).toContain('Практика');
    expect(header).toContain('ИНН');
    expect(header).toContain('ОГРН');
    expect(header).toContain('Домен');
    expect(header).toContain('Карьерная страница');
    const dataRow = csv.slice(BOM.length).split('\r\n')[1];
    expect(dataRow).toContain('lead-1');
    expect(dataRow).toContain('7701234567');
    expect(dataRow).toContain('example.com');
    expect(dataRow).toContain('https://example.com/careers');
  });

  it('emits empty identifier cells when the optional fields are absent', () => {
    const csv = leadsToCsv([
      makeLead({ orgInn: undefined, orgOgrn: undefined, orgDomain: undefined, careerPageUrl: undefined, profileName: undefined }),
    ]);
    const dataRow = csv.slice(BOM.length).split('\r\n')[1];
    // No "undefined" literal leaks into the CSV.
    expect(dataRow).not.toContain('undefined');
  });
});

describe('leadToCrmBlock', () => {
  it('renders a structured plain-text block with only the present fields', () => {
    const block = leadToCrmBlock({
      orgName: 'Ромашка',
      score: 320,
      confidenceGate: 'A',
      whyNow: 'Открыли 3 вакансии',
      lawfulContactPath: 'career-page',
      vacanciesCount: 3,
      evidenceTitles: ['Backend', 'DevOps'],
      locationNames: ['Москва'],
      sourceFamilies: ['career-pages'],
      feedbackStatus: 'contacted',
      latestPublishedAt: '2026-06-28',
      orgInn: '7701234567',
      orgDomain: 'romashka.ru',
      orgWebsite: 'https://romashka.ru',
      careerPageUrl: 'https://romashka.ru/careers',
      profileName: 'IT-подбор',
    });
    expect(block).toContain('Компания: Ромашка');
    expect(block).toContain('Практика: IT-подбор');
    expect(block).toContain('уверенность A');
    expect(block).toContain('Почему сейчас: Открыли 3 вакансии');
    expect(block).toContain('Безопасный контакт: Карьерная страница');
    expect(block).toContain('Домен: romashka.ru');
    expect(block).toContain('Сайт: https://romashka.ru');
    expect(block).toContain('ИНН: 7701234567');
    expect(block).toContain('Статус: contacted');
  });

  it('omits absent identifier lines instead of emitting empty "ИНН: "', () => {
    const block = leadToCrmBlock({
      orgName: 'Без ИНН',
      score: 200,
      confidenceGate: 'B',
      whyNow: '',
      lawfulContactPath: null,
      vacanciesCount: 0,
      evidenceTitles: [],
      locationNames: [],
      sourceFamilies: [],
      feedbackStatus: null,
      latestPublishedAt: null,
    });
    expect(block).not.toContain('ИНН:');
    expect(block).not.toContain('Домен:');
    expect(block).not.toContain('Почему сейчас:');
    expect(block).toContain('Компания: Без ИНН');
  });
});

describe('singleLeadToCsv', () => {
  it('produces a one-row CSV with the same column layout as the list export', () => {
    const csv = singleLeadToCsv({
      id: 'lead-99',
      orgName: 'Сингл',
      score: 300,
      confidenceGate: 'A',
      whyNow: 'всплеск',
      lawfulContactPath: 'career-page',
      vacanciesCount: 2,
      evidenceTitles: ['QA'],
      locationNames: ['Москва'],
      sourceFamilies: ['career-pages'],
      feedbackStatus: 'contacted',
      latestPublishedAt: '2026-06-28',
      orgInn: '7700000001',
      profileName: 'IT-подбор',
    });
    const rows = csv.slice(BOM.length).split('\r\n');
    expect(rows).toHaveLength(2); // header + 1 row
    expect(rows[0].split(',')).toHaveLength(LEADS_CSV_COLUMN_COUNT);
    expect(rows[1]).toContain('lead-99');
    expect(rows[1]).toContain('Сингл');
    expect(rows[1]).toContain('7700000001');
  });
});
