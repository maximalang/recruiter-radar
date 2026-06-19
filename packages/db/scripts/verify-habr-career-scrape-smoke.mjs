/**
 * Habr Career scraping smoke.
 *
 * Guards the extraction → normalization seam: `extractVacancyCardsFromHtml`
 * must emit the canonical keys (`job_title`, `company_name`) that
 * `normalizeJobPostingRecord` consumes. A key mismatch here silently drops
 * every scraped card ("N records received, 0 normalized") — this asserts the
 * full path survives.
 */

import assert from 'node:assert/strict';

import { extractVacancyCardsFromHtml } from './adapters/habr-career.mjs';
import { normalizeJobPostingRecord } from './adapters/rf-source-normalizers.mjs';

// Representative search-results markup: two vacancy cards in the structure the
// extractor matches (vacancy-card__inner + title/company/salary/location/skill).
const SAMPLE_HTML = `
<div class="vacancy-card__inner">
  <a class="vacancy-card__title-link" href="/vacancies/1000123?from=search">Senior Recruiter</a>
  <a class="vacancy-card__company-name" href="/companies/acme">Acme Tech</a>
  <div class="vacancy-card__salary">от 200 000 ₽</div>
  <div class="vacancy-card__location">Москва</div>
  <span class="vacancy-card__skill">Hiring</span>
  <span class="vacancy-card__skill">Sourcing</span>
</div></div></div>
<div class="vacancy-card__inner">
  <a class="vacancy-card__title-link" href="/vacancies/1000456">IT Recruiter</a>
  <a class="vacancy-card__company-name" href="/companies/beta">Beta Labs</a>
  <div class="vacancy-card__salary">по договорённости</div>
  <div class="vacancy-card__location">Remote</div>
</div></div></div>
`;

const records = extractVacancyCardsFromHtml(SAMPLE_HTML);

assert.equal(records.length, 2, 'both cards must be extracted');

// Extractor must emit the canonical keys the normalizer reads.
for (const record of records) {
  assert.ok(record.job_title, 'extracted card must carry job_title');
  assert.ok(record.company_name, 'extracted card must carry company_name');
  assert.equal(record.source_board, 'habr-career');
}

// Normalize exactly as source-habr-career.mjs does.
const context = { fetchedAt: '2026-06-19T00:00:00.000Z', sourceId: 'habr-career' };
const normalized = records.map((record, index) =>
  normalizeJobPostingRecord(record, { ...context, lineNumber: index + 1 }, { defaultBoard: 'habr-career' }),
);

const survivors = normalized.filter(Boolean);

assert.equal(
  survivors.length,
  2,
  `all extracted cards must normalize (regression: key mismatch drops cards). received ${records.length}, normalized ${survivors.length}`,
);

const first = survivors[0];
assert.equal(first.jobTitle, 'Senior Recruiter');
assert.equal(first.companyName, 'Acme Tech');
assert.equal(first.payload.board, 'habr-career');
assert.equal(first.signalType, 'job_posting');
assert.equal(first.signalExternalId, 'habr-career:1000123');
assert.equal(first.sourceUrl, 'https://career.habr.com/vacancies/1000123');

console.log(JSON.stringify({
  smoke: 'habr-career-scrape',
  cardsExtracted: records.length,
  normalizedRecords: survivors.length,
  sample: { jobTitle: first.jobTitle, companyName: first.companyName, board: first.payload.board },
}, null, 2));
