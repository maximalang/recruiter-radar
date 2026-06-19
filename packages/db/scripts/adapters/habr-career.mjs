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
 * Scrape vacancy cards from Habr Career search HTML.
 * Extracts structured data from the search results page.
 */
export function extractVacancyCardsFromHtml(html) {
  const records = [];

  // Pattern: vacancy cards in the HTML have class="vacancy-card__inner"
  // Each card contains structured data in data attributes and inner elements
  const cardPattern = /<div[^>]*class="vacancy-card__inner"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;

  let match;
  while ((match = cardPattern.exec(html)) !== null) {
    const cardHtml = match[1];

    // Extract vacancy link and ID
    const linkMatch = cardHtml.match(/href="\/vacancies\/(\d+)[^"]*"/);
    const id = linkMatch ? linkMatch[1] : null;
    const link = id ? `https://career.habr.com/vacancies/${id}` : null;

    // Extract title
    const titleMatch = cardHtml.match(/class="vacancy-card__title-link"[^>]*>([\s\S]*?)<\/a>/);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').trim() : null;

    // Extract company name
    const companyMatch = cardHtml.match(/class="vacancy-card__company-name"[^>]*>([\s\S]*?)<\/a>/);
    const company = companyMatch ? companyMatch[1].replace(/<[^>]*>/g, '').trim() : null;

    // Extract salary
    const salaryMatch = cardHtml.match(/class="vacancy-card__salary"[^>]*>([\s\S]*?)<\/div>/);
    const salary = salaryMatch ? salaryMatch[1].replace(/<[^>]*>/g, '').trim() : null;

    // Extract location
    const locationMatch = cardHtml.match(/class="vacancy-card__location"[^>]*>([\s\S]*?)<\//);
    const location = locationMatch ? locationMatch[1].replace(/<[^>]*>/g, '').trim() : null;

    // Extract skills/tags
    const skillPattern = /class="vacancy-card__skill"[^>]*>([\s\S]*?)<\/[^>]+>/g;
    const tags = [];
    let skillMatch;
    while ((skillMatch = skillPattern.exec(cardHtml)) !== null) {
      tags.push(skillMatch[1].replace(/<[^>]*>/g, '').trim());
    }

    if (title && id) {
      records.push({
        id,
        profession: title,
        firm_name: company,
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
