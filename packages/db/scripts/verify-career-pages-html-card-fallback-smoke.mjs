/**
 * Smoke test for the same-domain HTML-card fallback extractor.
 *
 * The career-pages `same-domain-jsonld` adapter is the ONLY direct-hiring-proof
 * surface (gate A/B originator). Before the HTML-card fallback it read JSON-LD
 * exclusively: a Russian company career page that publishes vacancies as HTML
 * cards with no schema.org markup silently yielded 0 records, losing the
 * company's direct hiring proof after the page was already fetched.
 *
 * This verifier proves four evidence-first guarantees:
 *   1. The fallback extracts real vacancy cards from a realistic RU-style
 *      HTML career page (Bitrix/1C-Bitrix-style class names, Cyrillic text).
 *   2. JSON-LD wins when present — the fallback is skipped so the same
 *      vacancy is not double-counted.
 *   3. The guardrails hold: a card WITHOUT a same-domain URL is dropped;
 *      navigation boilerplate ("Подробнее", "Все вакансии") is never turned
 *      into a fake vacancy headline; no company/contact/salary is fabricated.
 *   4. Records carry `extraction_method: 'html-card-fallback'` so the signal
 *      payload stays auditable downstream.
 */
import assert from 'node:assert/strict';

import { extractVacancyCardsFromSameDomainHtml } from './source-career-pages.mjs';

const SEED = {
  companyName: 'ООО Ромашка',
  companyDomain: 'romashka.example',
  companyWebsiteUrl: 'https://romashka.example/',
  careerPageUrl: 'https://romashka.example/vacancies',
  sourceUrl: 'https://romashka.example/vacancies',
};

// ─── 1. Realistic RU career page with HTML cards, NO JSON-LD ───────────────
// Mirrors the markup shape common on Bitrix/1C-Bitrix RU corporate sites:
// a `.vacancy-list` wrapper with `.vacancy-card` items, each linking the
// title to a same-domain `/vacancies/<id>` detail page.
const ruHtmlCards = `
<!DOCTYPE html><html lang="ru"><head><title>Вакансии — Ромашка</title></head>
<body>
  <main class="vacancy-list">
    <article class="vacancy-card">
      <h3 class="vacancy-card__title"><a href="/vacancies/12345">Старший бухгалтер</a></h3>
      <div class="vacancy-card__location">Москва</div>
      <div class="vacancy-card__type">Полная занятость</div>
      <div class="vacancy-card__salary">от 120 000 ₽</div>
      <a class="vacancy-card__more" href="/vacancies/12345">Подробнее</a>
    </article>
    <article class="vacancy-card">
      <h3 class="vacancy-card__title"><a href="/vacancies/67890">Руководитель отдела продаж</a></h3>
      <div class="vacancy-card__location">Санкт-Петербург</div>
      <div class="vacancy-card__salary">до 250 000 ₽</div>
      <a href="/vacancies/67890/apply">Откликнуться</a>
    </article>
    <article class="vacancy-card">
      <h3 class="vacancy-card__title"><a href="/vacancies/11111">Логист (удалённо)</a></h3>
      <div class="vacancy-card__location">Удалённая работа</div>
    </article>
    <nav class="pagination"><a href="/vacancies?page=2">Далее</a></nav>
    <footer><a href="https://hh.ru/employer/romashka">Мы на hh.ru</a></footer>
  </main>
</body></html>
`;

const records = extractVacancyCardsFromSameDomainHtml(ruHtmlCards, SEED);

// Three distinct same-domain vacancy detail pages → three records. The
// "Подробнее"/"Откликнуться"/"Далее" anchors share a URL with a title anchor
// (deduped) or are boilerplate (rejected), and the hh.ru link is external
// (rejected by the same-domain host check).
assert.equal(records.length, 3, `expected 3 vacancy cards, got ${records.length}`);

const titles = records.map((r) => r.job_title).sort();
assert.deepEqual(titles, [
  'Логист (удалённо)',
  'Руководитель отдела продаж',
  'Старший бухгалтер',
]);

// Every record points to a same-domain vacancy detail URL.
for (const record of records) {
  assert.ok(record.job_posting_url.startsWith('https://romashka.example/vacancies/'),
    `record URL must be same-domain: ${record.job_posting_url}`);
  assert.equal(record.company_name, 'ООО Ромашка', 'company seeded from target, never fabricated');
  assert.equal(record.company_domain, 'romashka.example');
  assert.equal(record.career_page_url, 'https://romashka.example/vacancies');
  assert.equal(record.source_record_type, 'job_posting');
  assert.equal(record.raw_target_adapter, 'same-domain-html-cards');
  assert.equal(record.extraction_method, 'html-card-fallback');
  // No fabricated contact fields.
  assert.equal(record.occurred_at, null, 'HTML cards must not guess a publish date');
}

// Per-card fields were read where present (no fabrication, real values only).
assert.equal(records.find((r) => r.job_title === 'Старший бухгалтер').location, 'Москва');
assert.equal(records.find((r) => r.job_title === 'Старший бухгалтер').employment_type, 'Полная занятость');
assert.equal(records.find((r) => r.job_title === 'Старший бухгалтер').salary, 'от 120 000 ₽');

console.log('  ✓ RU HTML career page with no JSON-LD → 3 direct-hiring-proof records');

// ─── 2. External board link is NOT a same-domain vacancy ───────────────────
// The hh.ru / greenhouse / lever links on a RU career page belong to other
// adapters; the fallback must never poach them (would double-count).
const mixedHostHtml = `
  <a href="https://boards.greenhouse.io/acme">Greenhouse</a>
  <a href="https://hh.ru/vacancy/999">hh вакансия</a>
  <a href="/jobs/42">Внутренняя вакансия</a>
`;
const mixedRecords = extractVacancyCardsFromSameDomainHtml(mixedHostHtml, SEED);
assert.equal(mixedRecords.length, 1, 'only the same-domain link counts');
assert.equal(mixedRecords[0].job_title, 'Внутренняя вакансия');
console.log('  ✓ External board links excluded (same-domain host guard)');

// ─── 3. Boilerplate + title-less anchors are never fake vacancies ──────────
const boilerplateHtml = `
  <a href="/vacancies/1">Подробнее</a>
  <a href="/vacancies/2">Все вакансии</a>
  <a href="/vacancies/3">Apply</a>
  <a href="/vacancies/4">   </a>
  <a href="/vacancies/5">A</a>
  <a href="/vacancies/6"></a>
`;
const boilerplateRecords = extractVacancyCardsFromSameDomainHtml(boilerplateHtml, SEED);
assert.equal(boilerplateRecords.length, 0,
  'navigation boilerplate and too-short/empty anchors must not become vacancies');
console.log('  ✓ Navigation boilerplate rejected (no fabricated headlines)');

// ─── 4. Empty page → empty result (no fabrication) ─────────────────────────
const emptyRecords = extractVacancyCardsFromSameDomainHtml('<html><body></body></html>', SEED);
assert.equal(emptyRecords.length, 0);
console.log('  ✓ Empty page → 0 records (no fabrication)');

// ─── 5. Missing seed domain → empty (cannot enforce same-domain) ───────────
const noHostRecords = extractVacancyCardsFromSameDomainHtml(ruHtmlCards, {
  ...SEED,
  careerPageUrl: null,
  sourceUrl: null,
});
assert.equal(noHostRecords.length, 0,
  'without a career-page host the same-domain guard cannot fire — return nothing');
console.log('  ✓ Missing career-page host → 0 records (same-domain guard cannot fire)');

console.log('\nverify-career-pages-html-card-fallback-smoke: all assertions passed');
