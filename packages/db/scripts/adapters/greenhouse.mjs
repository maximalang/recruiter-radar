import { fetchJson } from './source-http.mjs';

const GREENHOUSE_BASE_URL = 'https://boards-api.greenhouse.io/v1/boards';

export function parseGreenhouseJobs(responseBody, boardToken) {
  const jobs = responseBody?.jobs;

  if (!Array.isArray(jobs)) {
    return [];
  }

  return jobs.map((job) => ({
    external_id: job.id != null ? String(job.id) : null,
    board: 'greenhouse',
    company_name: responseBody.name ?? null,
    job_title: job.title ?? null,
    location: job.location?.name ?? null,
    job_posting_url: job.absolute_url ?? null,
    published_at: job.updated_at ?? job.created_at ?? null,
    tags: (job.departments ?? []).map((d) => d.name).filter(Boolean),
    _meta: { boardToken },
  }));
}

export async function fetchGreenhouseBoard(boardToken, { signal } = {}) {
  const url = `${GREENHOUSE_BASE_URL}/${encodeURIComponent(boardToken)}/jobs?content=true`;
  const body = await fetchJson(url, {
    sourceName: 'greenhouse',
    signal,
  });

  return parseGreenhouseJobs(body, boardToken);
}

export async function fetchGreenhouseBoards(boardTokens, { signal } = {}) {
  const results = [];

  for (const token of boardTokens) {
    const jobs = await fetchGreenhouseBoard(token, { signal });
    results.push(...jobs);
  }

  return results;
}
