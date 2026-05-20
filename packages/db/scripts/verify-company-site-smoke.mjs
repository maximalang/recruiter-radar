import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildFetchSummary,
  resolveCompanySiteInput,
  resolveCompanySiteLiveInput,
} from './source-company-site.mjs';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const fixturePath = resolve(scriptDir, './company-site-smoke-fixture.json');

process.env.COMPANY_SITE_INPUT_FILE = fixturePath;
delete process.env.DATABASE_URL;

const input = resolveCompanySiteInput();
const summary = buildFetchSummary(input);

assert.equal(summary.source, 'company-site');
assert.equal(summary.action, 'fetch');
assert.equal(summary.inputMode, 'file');
assert.equal(summary.inputFilePath, fixturePath);
assert.equal(summary.recordsReceived, 4);
assert.equal(summary.duplicateRecords, 0);
assert.equal(summary.normalizedRecords, 4);
assert.equal(summary.skippedRecords, 0);

const rec1 = input.normalizedRecords.find((r) => r.signalExternalId === 'cs-smoke-1');
assert.ok(rec1, 'missing normalized record cs-smoke-1');
assert.equal(rec1.companyName, 'Smoke Corp');
assert.equal(rec1.companyDomain, 'smokecorp.example');
assert.equal(rec1.companyWebsiteUrl, 'https://smokecorp.example/');
assert.equal(rec1.pageUrl, 'https://smokecorp.example/about');
assert.equal(rec1.pageTitle, 'О компании Smoke Corp');
assert.equal(rec1.summary, 'Smoke Corp — технологическая компания, 200 сотрудников, офис в Москве.');
assert.deepEqual(rec1.signals, ['рост команды', 'новый офис']);
assert.equal(rec1.detectedAt, '2026-05-01T10:00:00.000Z');
assert.equal(rec1.primarySourceKey, 'ext:cs-smoke-1');

const rec2 = input.normalizedRecords.find((r) => r.signalExternalId === 'cs-smoke-2');
assert.ok(rec2, 'missing normalized record cs-smoke-2');
assert.equal(rec2.companyName, 'Smoke Corp');
assert.deepEqual(rec2.signals, ['разработка', 'расширение', 'найм']);

const rec3 = input.normalizedRecords.find((r) => r.signalExternalId === 'cs-smoke-3');
assert.ok(rec3, 'missing normalized record cs-smoke-3');
assert.equal(rec3.companyName, 'Another Smoke LLC');
assert.equal(rec3.companyDomain, 'another-smoke.example');
assert.deepEqual(rec3.signals, ['новый филиал', 'Санкт-Петербург']);

const rec4 = input.normalizedRecords.find(
  (r) => r.signalExternalId === 'page-url:https://url-only-smoke.example/company/news',
);
assert.ok(rec4, 'missing normalized URL-only record');
assert.equal(rec4.companyName, null);
assert.equal(rec4.companyDomain, 'url-only-smoke.example');
assert.equal(rec4.orgName, 'url-only-smoke.example');
assert.equal(rec4.orgDisplayName, 'url-only-smoke.example');
assert.equal(rec4.primarySourceKey, 'domain:url-only-smoke.example');
assert.deepEqual(rec4.signals, ['expansion', 'team growth']);

for (const record of input.normalizedRecords) {
  assert.equal(record.orgSourceKeys.length > 0, true, `record ${record.signalExternalId} must have orgSourceKeys`);
  assert.ok(record.primarySourceKey, `record ${record.signalExternalId} must have primarySourceKey`);
}

const liveSmoke = await runLiveCrawlSmoke();

console.log(JSON.stringify({
  ok: true,
  source: 'company-site',
  mode: 'read-only-smoke',
  fixturePath,
  recordsReceived: summary.recordsReceived,
  duplicateRecords: summary.duplicateRecords,
  normalizedRecords: summary.normalizedRecords,
  skippedRecords: summary.skippedRecords,
  verifiedExternalIds: [
    'cs-smoke-1',
    'cs-smoke-2',
    'cs-smoke-3',
    'page-url:https://url-only-smoke.example/company/news',
  ],
  liveCrawl: liveSmoke,
  sideEffects: {
    databaseUrlUsed: false,
  },
}, null, 2));

async function runLiveCrawlSmoke() {
  const tempDir = mkdtempSync(join(tmpdir(), 'rr-company-site-smoke-'));
  mkdirSync(tempDir, { recursive: true });

  const server = createServer((req, res) => {
    if (req.url === '/careers') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`
        <!doctype html>
        <html>
          <head>
            <title>Live Smoke Careers</title>
            <meta name="description" content="Live Smoke is hiring product engineers.">
          </head>
          <body>
            <main>
              We are hiring. Join our team. Open positions for backend engineers.
            </main>
          </body>
        </html>
      `);
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });

  try {
    const address = await listen(server);
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const targetsPath = join(tempDir, 'targets.json');
    const failedTargetsPath = join(tempDir, 'failed-targets.json');

    writeFileSync(
      targetsPath,
      JSON.stringify([
        {
          url: `${baseUrl}/careers`,
          company_name: 'Live Smoke Inc',
          company_domain: 'livesmoke.example',
        },
      ], null, 2),
    );

    writeFileSync(
      failedTargetsPath,
      JSON.stringify([{ url: `${baseUrl}/missing` }], null, 2),
    );

    const liveInput = await resolveCompanySiteLiveInput({ targetsFilePath: targetsPath });
    const liveSummary = buildFetchSummary(liveInput);

    assert.equal(liveInput.inputMode, 'live-public');
    assert.equal(liveSummary.inputMode, 'live-public');
    assert.equal(liveSummary.targetsFilePath, targetsPath);
    assert.equal(liveSummary.recordsReceived, 1);
    assert.equal(liveSummary.duplicateRecords, 0);
    assert.equal(liveSummary.crawlSuccesses, 1);
    assert.equal(liveSummary.crawlErrors, 0);
    assert.equal(liveSummary.normalizedRecords, 1);
    assert.equal(liveSummary.skippedRecords, 0);

    const liveRecord = liveInput.normalizedRecords[0];
    assert.equal(liveRecord.companyName, 'Live Smoke Inc');
    assert.equal(liveRecord.companyDomain, 'livesmoke.example');
    assert.equal(liveRecord.pageUrl, `${baseUrl}/careers`);
    assert.equal(liveRecord.pageTitle, 'Live Smoke Careers');
    assert.ok(
      liveRecord.signals.includes('active_hiring'),
      'live crawl should detect active hiring evidence',
    );
    assert.ok(
      liveRecord.signals.includes('open_positions'),
      'live crawl should detect open positions evidence',
    );

    await assert.rejects(
      () => resolveCompanySiteLiveInput({ targetsFilePath: failedTargetsPath }),
      /0 usable pages/,
    );

    return {
      targetsVerified: liveSummary.recordsReceived,
      crawlSuccesses: liveSummary.crawlSuccesses,
      crawlErrors: liveSummary.crawlErrors,
      normalizedRecords: liveSummary.normalizedRecords,
      allFailedCrawlRejected: true,
    };
  } finally {
    await close(server);
    rmSync(tempDir, { recursive: true, force: true });
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
