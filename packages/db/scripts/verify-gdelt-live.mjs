import { createGdeltDocClient } from './adapters/gdelt-doc-client.mjs';

const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
url.searchParams.set('query', 'Yandex (funding OR expansion OR hiring)');
url.searchParams.set('mode', 'ArtList');
url.searchParams.set('format', 'json');
url.searchParams.set('maxrecords', '5');
url.searchParams.set('timespan', '1d');
url.searchParams.set('sort', 'datedesc');

const client = createGdeltDocClient({ maxAttempts: 1 });
try {
  const result = await client.request(url, { timeoutMs: 30_000 });
  const articles = Array.isArray(result.body?.articles) ? result.body.articles : [];
  console.log(JSON.stringify({
    ok: true,
    state: 'reachable',
    liveVerified: false,
    dbVerified: false,
    attempts: result.attempts,
    articles: articles.length,
    reason: 'GDELT responded, but this controlled no-DB verifier does not claim source-to-lineage verification.',
  }, null, 2));
} catch (error) {
  if (error?.status === 429) {
    console.log(JSON.stringify({
      ok: true,
      state: 'throttled',
      liveVerified: false,
      dbVerified: false,
      attempts: error.attempts,
      retryAfter: error.retryAfter,
      retryAt: error.retryAt ?? null,
      deferred: error.deferred === true,
      reason: error.retryAfter
        ? 'Controlled verifier stopped after one request; production scheduler will honor Retry-After before retrying.'
        : 'Controlled verifier stopped after one request; no Retry-After was returned, so production uses bounded exponential backoff with jitter.',
    }, null, 2));
  } else {
    throw error;
  }
}
