import { fetchJson } from './source-http.mjs';

const LEVER_BASE_URL = 'https://api.lever.co/v0/postings';

export function parseLeverPostings(postings, companySlug) {
  if (!Array.isArray(postings)) {
    return [];
  }

  return postings.map((posting) => ({
    external_id: posting.id ?? null,
    board: 'lever',
    company_name: posting.categories?.team ?? companySlug ?? null,
    job_title: posting.text ?? null,
    location: posting.categories?.location ?? null,
    job_posting_url: posting.hostedUrl ?? posting.applyUrl ?? null,
    published_at: posting.createdAt ? new Date(posting.createdAt).toISOString() : null,
    tags: [posting.categories?.department, posting.categories?.commitment].filter(Boolean),
    _meta: { companySlug },
  }));
}

export async function fetchLeverPostings(companySlug, { signal } = {}) {
  const url = `${LEVER_BASE_URL}/${encodeURIComponent(companySlug)}?mode=json`;
  const body = await fetchJson(url, {
    sourceName: 'lever',
    signal,
  });

  return parseLeverPostings(body, companySlug);
}

export async function fetchLeverCompanies(companySlugs, { signal } = {}) {
  const results = [];

  for (const slug of companySlugs) {
    const postings = await fetchLeverPostings(slug, { signal });
    results.push(...postings);
  }

  return results;
}
