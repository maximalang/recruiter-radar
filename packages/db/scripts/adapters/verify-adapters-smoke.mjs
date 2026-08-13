import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildHhVacanciesUrl,
  fetchHhVacancyPages,
  HhAccessForbiddenError,
  resolveHhVacancySearchConfig,
} from './hh.mjs';
import { parseGreenhouseJobs } from './greenhouse.mjs';
import { parseLeverPostings } from './lever.mjs';
import {
  buildRussianLegalNameSourceKey,
  buildSourceKeyAliases,
  dedupeNormalizedRecords,
  isRussianSoleProprietorName,
  normalizeRussianLegalName,
  stripBom,
} from './source-records.mjs';
import { fetchJson, fetchText } from './source-http.mjs';
import { buildCompanyIdentity } from './rf-source-runtime.mjs';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));

// --- Greenhouse adapter smoke ---
const ghFixture = JSON.parse(readFileSync(resolve(scriptDir, './greenhouse-fixture.json'), 'utf8'));
const ghRecords = parseGreenhouseJobs(ghFixture, 'testco');

assert.equal(ghRecords.length, 3, 'greenhouse must return all jobs including incomplete ones');

const ghJob1 = ghRecords.find((r) => r.external_id === '4012345');
assert.ok(ghJob1, 'missing greenhouse job 4012345');
assert.equal(ghJob1.board, 'greenhouse');
assert.equal(ghJob1.company_name, 'Test Company');
assert.equal(ghJob1.job_title, 'Senior Backend Engineer');
assert.equal(ghJob1.location, 'Moscow, Russia');
assert.equal(ghJob1.job_posting_url, 'https://boards.greenhouse.io/testco/jobs/4012345');
assert.deepEqual(ghJob1.tags, ['Engineering', 'Backend']);
assert.deepEqual(ghJob1._meta, { boardToken: 'testco' });

const ghJob2 = ghRecords.find((r) => r.external_id === '4012346');
assert.ok(ghJob2, 'missing greenhouse job 4012346');
assert.equal(ghJob2.job_title, 'Product Manager');
assert.equal(ghJob2.location, 'Remote');
assert.deepEqual(ghJob2.tags, ['Product']);

const ghJobIncomplete = ghRecords.find((r) => r.external_id === null && r.job_title === null);
assert.ok(ghJobIncomplete, 'incomplete greenhouse record must still be returned for downstream filtering');

// --- Lever adapter smoke ---
const leverFixture = JSON.parse(readFileSync(resolve(scriptDir, './lever-fixture.json'), 'utf8'));
const leverRecords = parseLeverPostings(leverFixture, 'testco');

assert.equal(leverRecords.length, 3, 'lever must return all postings including incomplete ones');

const leverJob1 = leverRecords.find((r) => r.external_id === 'lever-abc-001');
assert.ok(leverJob1, 'missing lever posting lever-abc-001');
assert.equal(leverJob1.board, 'lever');
assert.equal(leverJob1.company_name, 'LeverCo');
assert.equal(leverJob1.job_title, 'Frontend Engineer');
assert.equal(leverJob1.location, 'Saint Petersburg');
assert.equal(leverJob1.job_posting_url, 'https://jobs.lever.co/testco/lever-abc-001');
assert.deepEqual(leverJob1.tags, ['Engineering', 'Full-time']);
assert.deepEqual(leverJob1._meta, { companySlug: 'testco' });
assert.ok(leverJob1.published_at, 'lever posting must have published_at from createdAt');

const leverJob2 = leverRecords.find((r) => r.external_id === 'lever-abc-002');
assert.ok(leverJob2, 'missing lever posting lever-abc-002');
assert.equal(leverJob2.job_title, 'Data Analyst');
assert.deepEqual(leverJob2.tags, ['Analytics']);

const leverIncomplete = leverRecords.find((r) => r.external_id === null && r.job_title === null);
assert.ok(leverIncomplete, 'incomplete lever record must still be returned for downstream filtering');

const hhSmoke = await runHhAdapterSmoke();
const sourceRecordsSmoke = runSourceRecordsSmoke();
const sourceHttpSmoke = await runSourceHttpSmoke();

console.log(JSON.stringify({
  ok: true,
  smoke: 'adapter-parsers',
  hh: hhSmoke,
  greenhouse: { parsed: ghRecords.length, validJobs: ghRecords.filter((r) => r.job_title).length },
  lever: { parsed: leverRecords.length, validJobs: leverRecords.filter((r) => r.job_title).length },
  sourceRecords: sourceRecordsSmoke,
  sourceHttp: sourceHttpSmoke,
}, null, 2));

function runSourceRecordsSmoke() {
  assert.equal(stripBom('\uFEFF{ok:true}'), '{ok:true}');
  assert.equal(stripBom('\u00EF\u00BB\u00BF{ok:true}'), '{ok:true}');
  assert.equal(stripBom('\u043F\u00BB\u0457{ok:true}'), '{ok:true}');
  assert.equal(normalizeRussianLegalName('\u041e\u041e\u041e \u0420\u043e\u043c\u0430\u0448\u043a\u0430'), '\u0440\u043e\u043c\u0430\u0448\u043a\u0430');
  assert.equal(
    buildRussianLegalNameSourceKey('\u041e\u0431\u0449\u0435\u0441\u0442\u0432\u043e \u0441 \u043e\u0433\u0440\u0430\u043d\u0438\u0447\u0435\u043d\u043d\u043e\u0439 \u043e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0435\u043d\u043d\u043e\u0441\u0442\u044c\u044e \u0420\u043e\u043c\u0430\u0448\u043a\u0430'),
    'ru-legal-name:\u0440\u043e\u043c\u0430\u0448\u043a\u0430',
  );
  assert.equal(isRussianSoleProprietorName('\u0418\u041f \u0418\u0432\u0430\u043d\u043e\u0432 \u0418\u0432\u0430\u043d'), true);
  assert.equal(buildRussianLegalNameSourceKey('\u0418\u041f \u0418\u0432\u0430\u043d\u043e\u0432 \u0418\u0432\u0430\u043d'), null);
  assert.deepEqual(
    buildSourceKeyAliases(['domain:romashka.ru', 'company-name:ooo romashka'], ['ru-legal-name:romashka'], 'domain:romashka.ru'),
    ['company-name:ooo romashka', 'ru-legal-name:romashka'],
  );
  assert.equal(
    buildCompanyIdentity({
      companyName: null,
      companyDomain: null,
      companyWebsiteUrl: null,
      sourceUrl: 'https://jobs.example/vacancies/1',
      fallbackName: null,
      lineNumber: 1,
    }),
    null,
    'RF source identity must not infer company domain from job/article/source URLs',
  );

  const dedupeResult = dedupeNormalizedRecords([
    { signalExternalId: 'one', value: 1 },
    { signalExternalId: 'one', value: 2 },
    { signal_external_id: 'two', value: 3 },
    { signalExternalID: 'two', value: 4 },
    { value: 5 },
  ]);

  assert.equal(dedupeResult.records.length, 3);
  assert.equal(dedupeResult.duplicateRecords, 2);
  assert.deepEqual(dedupeResult.records.map((record) => record.value), [1, 3, 5]);

  return {
    bomStripVerified: true,
    dedupeVerified: true,
    russianLegalNameVerified: true,
    sourceUrlIdentityRejected: true,
    duplicateRecords: dedupeResult.duplicateRecords,
  };
}

async function runHhAdapterSmoke() {
  const config = resolveHhVacancySearchConfig({
    HH_SEARCH_TEXT: 'backend recruiter',
    HH_PER_PAGE: '2',
    HH_PAGES: '2',
    HH_AREA: '1,2',
    HH_PROFESSIONAL_ROLE: '96',
  });
  const pageOneUrl = buildHhVacanciesUrl(config, 1);

  assert.equal(pageOneUrl.searchParams.get('text'), 'backend recruiter');
  assert.equal(pageOneUrl.searchParams.get('per_page'), '2');
  assert.equal(pageOneUrl.searchParams.get('page'), '1');
  assert.deepEqual(pageOneUrl.searchParams.getAll('area'), ['1', '2']);
  assert.deepEqual(pageOneUrl.searchParams.getAll('professional_role'), ['96']);

  const originalFetch = globalThis.fetch;
  const requestedPages = [];

  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = new URL(String(url));
    const page = Number(requestUrl.searchParams.get('page'));
    requestedPages.push(page);

    assert.equal(options.headers?.['user-agent'], 'RecruiterRadarSmoke/1.0');

    return jsonResponse({
      found: 3,
      pages: 2,
      items: page === 0
        ? [{ id: 'hh-smoke-1', name: 'Recruiter', employer: { id: '1', name: 'HH Smoke 1' } }]
        : [{ id: 'hh-smoke-2', name: 'Senior Recruiter', employer: { id: '2', name: 'HH Smoke 2' } }],
    });
  };

  try {
    const result = await fetchHhVacancyPages({
      userAgent: 'RecruiterRadarSmoke/1.0',
      config,
    });

    assert.equal(result.items.length, 2);
    assert.equal(result.pagesFetched, 2);
    assert.deepEqual(requestedPages, [0, 1]);

    const forbiddenVerified = await verifyHhForbiddenMapping(config);

    return {
      configuredPages: config.pages,
      pagesFetched: result.pagesFetched,
      items: result.items.length,
      forbiddenVerified,
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

/**
 * A 403 `forbidden` from HH search must surface as HhAccessForbiddenError with
 * a secret-safe neutral message — not a guessed infrastructure diagnosis.
 * Caller restores globalThis.fetch in its finally block.
 */
async function verifyHhForbiddenMapping(config) {
  globalThis.fetch = async () =>
    jsonResponse({ errors: [{ type: 'forbidden' }] }, { status: 403 });

  await assert.rejects(
    () => fetchHhVacancyPages({ userAgent: 'RecruiterRadarSmoke/1.0', config }),
    (error) => {
      assert.ok(
        error instanceof HhAccessForbiddenError,
        'HH 403 forbidden must map to HhAccessForbiddenError',
      );
      assert.equal(error.status, 403);
      assert.match(error.message, /authenticated application diagnostic/);
      assert.doesNotMatch(error.message, /geo|proxy|RU-resident/i);
      return true;
    },
  );

  return true;
}

async function runSourceHttpSmoke() {
  let jsonRetryRequests = 0;
  let fallbackRequests = 0;

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');

    if (url.pathname === '/json-retry') {
      jsonRetryRequests += 1;

      if (jsonRetryRequests === 1) {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false }));
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, attempts: jsonRetryRequests }));
      return;
    }

    if (url.pathname === '/json-fallback') {
      fallbackRequests += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, transport: 'node-http-fallback' }));
      return;
    }

    if (url.pathname === '/text') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('adapter smoke text');
      return;
    }

    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false }));
  });

  try {
    const address = await listen(server);
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const json = await fetchJson(`${baseUrl}/json-retry?api_key=secret-value`, {
      sourceName: 'source-http-smoke',
      retries: 1,
      retryDelayMs: 1,
      timeoutMs: 1000,
    });

    assert.equal(json.ok, true);
    assert.equal(json.attempts, 2);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new TypeError('fetch failed');
    };

    try {
      const fallbackJson = await fetchJson(`${baseUrl}/json-fallback?token=secret-value`, {
        sourceName: 'source-http-smoke',
        retries: 0,
        timeoutMs: 1000,
        nodeHttpFallback: true,
      });

      assert.equal(fallbackJson.ok, true);
      assert.equal(fallbackJson.transport, 'node-http-fallback');
      assert.equal(fallbackRequests, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }

    const text = await fetchText(`${baseUrl}/text`, {
      sourceName: 'source-http-smoke',
      retries: 0,
      timeoutMs: 1000,
    });

    assert.equal(text.body, 'adapter smoke text');

    await assert.rejects(
      () => fetchJson(`${baseUrl}/error?token=secret-value`, {
        sourceName: 'source-http-smoke',
        retries: 0,
        timeoutMs: 1000,
      }),
      (error) => {
        assert.match(error.message, /HTTP 500/);
        assert.equal(error.message.includes('secret-value'), false);
        return true;
      },
    );

    await assert.rejects(
      () => fetchJson(`${baseUrl}/error?password=secret-value`, {
        sourceName: 'source-http-smoke',
        preferNodeHttpFallback: true,
        retries: 0,
        timeoutMs: 1000,
      }),
      (error) => {
        assert.match(error.message, /HTTP 500/);
        assert.equal(error.message.includes('secret-value'), false);
        return true;
      },
    );

    return {
      retryRequests: jsonRetryRequests,
      fallbackRequests,
      textFetchVerified: true,
      errorRedactionVerified: true,
    };
  } finally {
    await close(server);
  }
}

function listen(server) {
  return new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen);
      resolveListen(server.address());
    });
  });
}

function close(server) {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) {
        rejectClose(error);
        return;
      }

      resolveClose();
    });
  });
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}
