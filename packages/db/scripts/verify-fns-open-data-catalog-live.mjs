import assert from 'node:assert/strict';

import {
  assertOfficialFnsArchiveUrl,
  discoverLatestFnsArchiveUrl,
} from './sync-fns-open-data-snapshot.mjs';
import { fetchWithSourcePolicy } from './adapters/source-http.mjs';

const datasets = ['headcount', 'revenue-expenses', 'tax-regime'];
const evidence = [];

for (const dataset of datasets) {
  const archiveUrl = await discoverLatestFnsArchiveUrl(dataset);
  assert.equal(assertOfficialFnsArchiveUrl(dataset, archiveUrl), archiveUrl);
  const response = await fetchWithSourcePolicy(archiveUrl, {
    method: 'HEAD',
    redirect: 'follow',
    sourceName: `FNS ${dataset} archive metadata`,
    timeoutMs: 30_000,
  });
  assert.equal(response.ok, true, `${dataset} official archive HEAD returned HTTP ${response.status}`);
  assert.equal(assertOfficialFnsArchiveUrl(dataset, response.url || archiveUrl), archiveUrl);
  const bytes = Number(response.headers.get('content-length'));
  assert.equal(Number.isFinite(bytes) && bytes > 0, true, `${dataset} official archive must expose a positive content-length`);
  evidence.push({ dataset, archiveUrl, bytes, lastModified: response.headers.get('last-modified') });
}

console.log(JSON.stringify({
  ok: true,
  verifier: 'fns-open-data-catalog-live',
  datasets: evidence,
  boundary: 'catalog and archive metadata only; the verifier does not download bulk archives',
}, null, 2));
