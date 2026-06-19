/**
 * Habr Career adapter.
 *
 * Habr Career (career.habr.com) does not expose a documented public REST API
 * for vacancy search. Access requires a partner API token obtained via
 * Habr business team. This adapter supports two fetch modes:
 *
 *   1. Provider mode: HABR_CAREER_PROVIDER_API_URL + token → fetch from provider
 *   2. Scraping mode (fallback): Crawlee or Firecrawl → scrape career.habr.com
 *      search results. This mode is slower and requires Crawlee/Firecrawl setup.
 *
 * For scraping mode, the adapter fetches:
 *   - https://career.habr.com/vacancies?q=<keyword>&page=<N>
 *   - Extracts vacancy cards from the HTML response
 *   - Each card contains: title, company, salary, location, skills, link
 *
 * Rate limit: Be respectful — add 2s delay between pages for scraping.
 */

import { fetchJson, fetchText } from './source-http.mjs';
import {
  toNonEmptyText,
  clampInteger,
} from './rf-source-runtime.mjs';

const HABR_CAREER_SEARCH_URL = 'https://career.habr.com/vacancies';
const DEFAULT_KEYWORD = 'рекрутер';
const DEFAULT_PER_PAGE = 50; // Habr shows ~50 per page
const DEFAULT_PAGES = 3;
const MAX_PAGES = 10;
const SCRAPE_DELAY_MS = 2000;

const ENV_PARAM_MAP = [
  ['HABR_CAREER_TYPE', 'type'],
  ['HABR_CAREER_QUALIFICATION', 'qualification'],
  ['HABR_CAREER_REMOTE', 'remote'],
  ['HABR_CAREER_RELOCATION', 'relocation'],
  ['HABR_CAREER_CITY', 'city'],
  ['HABR_CAREER_CURRENCY', 'currency'],
  ['HABR_CAREER_SALAY_FROM', 'salary_from'],
  ['HABR_CAREER_SALAY_TO', 'salary_to'],
];

/**
 * Parse a multi-keyword env value into a deduped, order-stable list.
 * Accepts comma- or newline-separated keywords. Returns [] when empty.
 */
function parseKeywordList(raw) {
  const text = toNonEmptyText(raw);
  if (!text) return [];
  const seen = new Set();
  const list = [];
  for (const part of text.split(/[,\n]/)) {
    const kw = part.trim();
    if (!kw) continue;
    const dedupeKey = kw.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    list.push(kw);
  }
  return list;
}

/**
 * Resolve search config from env vars.
 *
 * Keyword precedence: HABR_CAREER_KEYWORDS (multi, comma/newline-separated) →
 * HABR_CAREER_KEYWORD (single) → DEFAULT_KEYWORD. `keywords` is the list the
 * fetcher iterates; `keyword` mirrors the first entry for back-compat summaries.
 */
export function resolveHabrCareerSearchConfig(env = process.env) {
  const multi = parseKeywordList(env.HABR_CAREER_KEYWORDS);
  const single = toNonEmptyText(env.HABR_CAREER_KEYWORD);
  const keywords = multi.length > 0 ? multi : single ? [single] : [DEFAULT_KEYWORD];
  const pages = clampInteger(env.HABR_CAREER_PAGES, DEFAULT_PAGES, 1, MAX_PAGES);
  const extraParams = {};

  for (const [envName, paramName] of ENV_PARAM_MAP) {
    const value = toNonEmptyText(env[envName]);
    if (value) {
      extraParams[paramName] = value;
    }
  }

  return {
    keywords,
    keyword: keywords[0],
    pages,
    extraParams,
  };
}

/**
 * Build the Habr Career search URL for a given page.
 *
 * `keyword` defaults to the config's primary keyword; the multi-keyword fetcher
 * passes each keyword explicitly so one config can drive several searches.
 */
export function buildHabrCareerSearchUrl(config, page = 1, keyword = config.keyword) {
  const url = new URL(HABR_CAREER_SEARCH_URL);
  url.searchParams.set('q', keyword);
  if (page > 1) {
    url.searchParams.set('page', String(page));
  }

  for (const [key, value] of Object.entries(config.extraParams ?? {})) {
    url.searchParams.set(key, String(value));
  }

  return url;
}

/**
 * Decode the small set of HTML entities Habr Career emits in card text
 * (company names like "RWB (Wildberries &amp; Russ)"). Not a full HTML
 * decoder — just the entities that appear in plain card copy.
 */
function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Strip tags, decode entities, collapse whitespace. Returns null when empty.
 */
function cleanCardText(raw) {
  if (raw == null) return null;
  const text = decodeHtmlEntities(String(raw).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 0 ? text : null;
}

/**
 * Split the search-results HTML into per-card fragments.
 *
 * Cards start at `vacancy-card__inner`; each fragment runs up to the next
 * card start (or end of document). This avoids the old `</div></div></div>`
 * boundary, which collapsed adjacent cards when the markup nested deeper.
 */
function splitVacancyCards(html) {
  const marker = 'vacancy-card__inner';
  const fragments = [];
  let cursor = html.indexOf(marker);
  if (cursor === -1) return fragments;

  while (cursor !== -1) {
    const next = html.indexOf(marker, cursor + marker.length);
    fragments.push(next === -1 ? html.slice(cursor) : html.slice(cursor, next));
    cursor = next;
  }
  return fragments;
}

/**
 * Scrape vacancy cards from Habr Career search HTML.
 *
 * Tolerant of two markup generations: the current career.habr.com layout
 * (2026: `vacancy-card__company` link, `chip-with-icon__text` location,
 * `predicted-salary` block, `vacancy-card__skills-chip`) and the older
 * selectors (`vacancy-card__company-name`, `vacancy-card__location`,
 * `vacancy-card__salary`, `vacancy-card__skill`) kept as fallbacks so the
 * extractor degrades gracefully instead of dropping every card on a redesign.
 */
export function extractVacancyCardsFromHtml(html) {
  const records = [];

  for (const cardHtml of splitVacancyCards(html)) {
    // Vacancy link + numeric id.
    const linkMatch = cardHtml.match(/href="\/vacancies\/(\d+)[^"]*"/);
    const id = linkMatch ? linkMatch[1] : null;
    const link = id ? `https://career.habr.com/vacancies/${id}` : null;

    // Title.
    const titleMatch = cardHtml.match(/class="vacancy-card__title-link"[^>]*>([\s\S]*?)<\/a>/);
    const title = cleanCardText(titleMatch?.[1]);

    // Company: current layout wraps the name in the first <a> inside
    // `vacancy-card__company`; fall back to the legacy `__company-name` link.
    let company = null;
    let companySlug = null;
    const companyBlockMatch = cardHtml.match(/class="vacancy-card__company"[^>]*>([\s\S]*?)<div class="vacancy-card__title/);
    const companyBlock = companyBlockMatch ? companyBlockMatch[1] : cardHtml;
    const companyLinkMatch = companyBlock.match(/<a[^>]*href="\/companies\/([^"/?]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/);
    if (companyLinkMatch) {
      companySlug = companyLinkMatch[1];
      company = cleanCardText(companyLinkMatch[2]);
    } else {
      const legacyCompanyMatch = cardHtml.match(/class="vacancy-card__company-name"[^>]*>([\s\S]*?)<\/a>/);
      company = cleanCardText(legacyCompanyMatch?.[1]);
    }

    // Salary: only keep an explicit figure (contains ₽). The
    // `predicted-salary__title` holds the real salary only when it carries ₽;
    // otherwise it's the "Зарплата не указана" placeholder, and the sibling
    // tooltip ("Похожие специалисты получают … ₽") is an estimate, not the
    // salary. Read the title element directly and ignore the tooltip.
    let salary = null;
    const salaryBlockMatch = cardHtml.match(/class="vacancy-card__salary"[^>]*>([\s\S]*?)(?:<div class="vacancy-card__meta|<div class="vacancy-card__skills|$)/);
    if (salaryBlockMatch) {
      const isEstimate = (t) => /не указан/i.test(t) || /получают/i.test(t) || /похожие/i.test(t);
      const titleSalaryMatch = salaryBlockMatch[1].match(/class="predicted-salary__title[^"]*"[^>]*>([\s\S]*?)<\/h4>/);
      if (titleSalaryMatch) {
        const titleSalary = cleanCardText(titleSalaryMatch[1]);
        if (titleSalary && /₽/.test(titleSalary) && !isEstimate(titleSalary)) {
          salary = titleSalary;
        }
      } else {
        // Legacy markup put the real salary directly in __salary.
        const legacy = cleanCardText(salaryBlockMatch[1]);
        if (legacy && !isEstimate(legacy)) {
          salary = legacy;
        }
      }
    }

    // Location: `vacancy-card__meta` holds several icon-chips that share the
    // `chip-with-icon__text` class — only the one with the `placemark` icon is
    // the city. Other chips (`format` → "Можно удалённо", `grade` → "Middle")
    // are work-mode/seniority and must NOT be treated as location. Fall back to
    // the legacy `__location` element when the meta block is absent.
    let location = null;
    const metaMatch = cardHtml.match(/class="vacancy-card__meta"[^>]*>([\s\S]*?)(?:<div class="vacancy-card__skills|$)/);
    if (metaMatch) {
      const placemarkMatch = metaMatch[1].match(/svg-icon--icon-placemark[\s\S]*?class="chip-with-icon__text"[^>]*>([\s\S]*?)<\/div>/);
      location = cleanCardText(placemarkMatch?.[1]);
    }
    if (!location) {
      const legacyLocationMatch = cardHtml.match(/class="vacancy-card__location"[^>]*>([\s\S]*?)<\//);
      location = cleanCardText(legacyLocationMatch?.[1]);
    }

    // Skills/tags: current `vacancy-card__skills-chip` (an <a>, possibly with
    // other classes in the attribute), legacy `vacancy-card__skill` (a <span>).
    // Match the class token anywhere in the attribute, not as the whole value.
    const tags = [];
    const skillPattern = /class="[^"]*\bvacancy-card__skills-chip\b[^"]*"[^>]*>([\s\S]*?)<\/a>|class="[^"]*\bvacancy-card__skill\b[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/g;
    let skillMatch;
    while ((skillMatch = skillPattern.exec(cardHtml)) !== null) {
      const tag = cleanCardText(skillMatch[1] ?? skillMatch[2]);
      if (tag) tags.push(tag);
    }

    if (title && id) {
      records.push({
        id,
        job_title: title,
        company_name: company,
        company_slug: companySlug,
        link,
        salary,
        location,
        tags,
        source_board: 'habr-career',
      });
    }
  }

  return records;
}

/**
 * Fetch vacancy pages by scraping Habr Career search.
 * Falls back to HTML scraping because no public API exists.
 *
 * Iterates every keyword in `config.keywords` (role-derived union from active
 * profiles, or a single explicit keyword). Vacancies are deduped by id ACROSS
 * keywords so a vacancy matching two keywords is upserted once. Each keyword is
 * paged independently and stops early when a page yields nothing.
 */
export async function fetchHabrCareerPages({ config = resolveHabrCareerSearchConfig() }) {
  const keywords = config.keywords?.length ? config.keywords : [config.keyword];
  const items = [];
  const seenIds = new Set();
  const pageSummaries = [];

  for (let k = 0; k < keywords.length; k += 1) {
    const keyword = keywords[k];

    for (let page = 1; page <= config.pages; page += 1) {
      const url = buildHabrCareerSearchUrl(config, page, keyword);

      const { body: html } = await fetchText(url.toString(), {
        sourceName: 'habr-career',
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'user-agent': 'RecruiterRadar/1.0 (habr-career source; contact: ops@example.com)',
        },
      });

      const pageItems = extractVacancyCardsFromHtml(html);
      let added = 0;
      for (const item of pageItems) {
        if (item.id != null && seenIds.has(item.id)) continue;
        if (item.id != null) seenIds.add(item.id);
        items.push(item);
        added += 1;
      }

      pageSummaries.push({
        keyword,
        page,
        items: pageItems.length,
        added,
      });

      // No more results for this keyword
      if (pageItems.length === 0) {
        break;
      }

      // Rate limit — be respectful. Delay between pages, and between keywords.
      const morePages = page < config.pages;
      const moreKeywords = k < keywords.length - 1;
      if (morePages || (page === config.pages && moreKeywords)) {
        await new Promise((resolve) => setTimeout(resolve, SCRAPE_DELAY_MS));
      }
    }
  }

  return {
    total: items.length,
    pagesFetched: pageSummaries.length,
    pageSummaries,
    items,
    config: summarizeHabrCareerSearchConfig(config),
  };
}

function summarizeHabrCareerSearchConfig(config) {
  return {
    keyword: config.keyword,
    keywords: config.keywords ?? (config.keyword ? [config.keyword] : []),
    pages: config.pages,
    extraParams: config.extraParams ?? {},
  };
}
