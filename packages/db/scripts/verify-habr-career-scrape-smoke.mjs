/**
 * Habr Career reviewed-snapshot parser smoke.
 *
 * Guards the extraction → normalization seam: `extractVacancyCardsFromHtml`
 * must emit the canonical keys (`job_title`, `company_name`) that
 * `normalizeJobPostingRecord` consumes. A key mismatch here silently drops
 * every scraped card ("N records received, 0 normalized") — this asserts the
 * full path survives. This fixture-only verifier performs no network request
 * and does not authorize direct commercial HTML collection.
 */

import assert from 'node:assert/strict';

import { extractVacancyCardsFromHtml } from './adapters/habr-career.mjs';
import { normalizeJobPostingRecord } from './adapters/rf-source-normalizers.mjs';

// Legacy markup: the pre-2026 structure (flat title/company/salary/location/skill).
// Kept so the extractor's fallback selectors stay covered.
const LEGACY_HTML = `
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

// Current career.habr.com markup (2026): nested company link with slug,
// `predicted-salary` placeholder (real salary in a range or absent),
// `chip-with-icon__text` location, `vacancy-card__skills-chip` skills.
const CURRENT_HTML = `
<div class="vacancy-card__inner">
  <div class="vacancy-card__info">
    <div class="vacancy-card__company">
      <a class="link-comp link-comp--appearance-dark" href="/companies/rwb">RWB (Wildberries &amp; Russ)</a>
      <div class="vacancy-card__company-rating"><a href="/companies/rwb/scores/2025">4.39</a></div>
    </div>
    <div class="vacancy-card__title">
      <a class="vacancy-card__title-link" href="/vacancies/1000165792">Специалист по подбору персонала</a>
    </div>
    <div class="vacancy-card__salary">
      <div class="predicted-salary">
        <h4 class="predicted-salary__title">Зарплата не указана</h4>
        <span class="tooltip">Похожие специалисты получают 113 000 - 205 000 ₽</span>
      </div>
    </div>
    <div class="vacancy-card__meta">
      <div class="basic-chip">
        <div class="chip-with-icon__icon"><svg class="svg-icon svg-icon--icon-placemark"></svg></div>
        <div class="chip-with-icon__text">Москва</div>
      </div>
    </div>
    <div class="vacancy-card__skills">
      <a class="basic-chip vacancy-card__skills-chip" href="/vacancies/skills/poisk-talantov">Поиск талантов</a>
    </div>
  </div>
</div>
<div class="vacancy-card__inner">
  <div class="vacancy-card__info">
    <div class="vacancy-card__company">
      <a class="link-comp" href="/companies/aston">Aston</a>
    </div>
    <div class="vacancy-card__title">
      <a class="vacancy-card__title-link" href="/vacancies/1000170001">IT-рекрутер</a>
    </div>
    <div class="vacancy-card__salary">
      <div class="predicted-salary">
        <h4 class="predicted-salary__title">от 70 000 до 104 000 ₽</h4>
      </div>
    </div>
    <div class="vacancy-card__meta">
      <div class="basic-chip">
        <div class="chip-with-icon__icon"><svg class="svg-icon svg-icon--icon-placemark"></svg></div>
        <div class="chip-with-icon__text">Нижний Новгород</div>
      </div>
      <div class="basic-chip">
        <div class="chip-with-icon__icon"><svg class="svg-icon svg-icon--icon-format"></svg></div>
        <div class="chip-with-icon__text">Можно удалённо</div>
      </div>
    </div>
  </div>
</div>
`;

const records = extractVacancyCardsFromHtml(LEGACY_HTML);

assert.equal(records.length, 2, 'both legacy cards must be extracted');

// --- Current-markup coverage: the 2026 layout must extract cleanly ---------
const currentRecords = extractVacancyCardsFromHtml(CURRENT_HTML);
assert.equal(currentRecords.length, 2, 'both current-markup cards must be extracted');

const [rwb, aston] = currentRecords;

assert.equal(rwb.job_title, 'Специалист по подбору персонала');
assert.equal(rwb.company_name, 'RWB (Wildberries & Russ)', 'company name must decode &amp;');
assert.equal(rwb.company_slug, 'rwb', 'company slug must come from /companies/<slug>');
assert.equal(rwb.location, 'Москва', 'location must come from the meta icon-chip');
assert.equal(rwb.salary, null, 'placeholder "Зарплата не указана" must not become a salary');
assert.deepEqual(rwb.tags, ['Поиск талантов'], 'skills must come from skills-chip');

assert.equal(aston.company_name, 'Aston');
assert.equal(aston.company_slug, 'aston');
assert.equal(aston.location, 'Нижний Новгород');
assert.ok(aston.salary && aston.salary.includes('₽'), 'explicit salary range must be kept');

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
  smoke: 'habr-career-snapshot-parser',
  cardsExtracted: records.length,
  normalizedRecords: survivors.length,
  sample: { jobTitle: first.jobTitle, companyName: first.companyName, board: first.payload.board },
}, null, 2));
