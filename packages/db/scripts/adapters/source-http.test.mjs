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

test('retry back-off honours Retry-After delta-seconds before the final attempt', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' });
    response.end('{"error":"throttled"}');
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  try {
    const address = server.address();
    const startedAt = Date.now();
    await assert.rejects(
      () => fetchJson(`http://127.0.0.1:${address.port}/`, {
        retries: 1,
        retryDelayMs: 0,
        sourceName: 'retry-after-delay-test',
      }),
      (error) => error.status === 429,
    );
    const elapsedMs = Date.now() - startedAt;
    // Two attempts with retryDelayMs 0: without the Retry-After honour the
    // whole run finishes almost instantly. The single Retry-After: 1 second
    // must stretch the second attempt past 900ms.
    assert.ok(elapsedMs >= 900, `expected >=900ms elapsed, got ${elapsedMs}ms`);
  } finally {
    await new Promise((resolvePromise, rejectPromise) => server.close((error) => error ? rejectPromise(error) : resolvePromise()));
  }
});

test('retry back-off stays immediate when the throttled response has no Retry-After', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(429, { 'content-type': 'application/json' });
    response.end('{"error":"throttled"}');
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  try {
    const address = server.address();
    const startedAt = Date.now();
    await assert.rejects(
      () => fetchJson(`http://127.0.0.1:${address.port}/`, {
        retries: 1,
        retryDelayMs: 0,
        sourceName: 'no-retry-after-delay-test',
      }),
      (error) => error.status === 429,
    );
    const elapsedMs = Date.now() - startedAt;
    assert.ok(elapsedMs < 900, `expected <900ms elapsed, got ${elapsedMs}ms`);
  } finally {
    await new Promise((resolvePromise, rejectPromise) => server.close((error) => error ? rejectPromise(error) : resolvePromise()));
  }
});

test('eventual success after a Retry-After-throttled first attempt', async () => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    if (requests === 1) {
      response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' });
      response.end('{"error":"throttled"}');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"ok":true}');
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  try {
    const address = server.address();
    const payload = await fetchJson(`http://127.0.0.1:${address.port}/`, {
      retries: 2,
      retryDelayMs: 0,
      sourceName: 'retry-after-recovery-test',
    });
    assert.deepEqual(payload, { ok: true });
    assert.equal(requests, 2);
  } finally {
    await new Promise((resolvePromise, rejectPromise) => server.close((error) => error ? rejectPromise(error) : resolvePromise()));
  }
});
