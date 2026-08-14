import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { fetchJson } from './source-http.mjs';

test('node-http fallback preserves Retry-After on throttled responses', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '45' });
    response.end('{"error":"throttled"}');
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  try {
    const address = server.address();
    await assert.rejects(
      () => fetchJson(`http://127.0.0.1:${address.port}/`, {
        preferNodeHttpFallback: true,
        retries: 0,
        sourceName: 'retry-after-test',
      }),
      (error) => error.status === 429 && error.retryAfter === '45' && error.attempt === 1,
    );
  } finally {
    await new Promise((resolvePromise, rejectPromise) => server.close((error) => error ? rejectPromise(error) : resolvePromise()));
  }
});
