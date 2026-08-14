import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  assertOfficialEisUrl,
  buildGovernmentProcurementSnapshot,
  discoverEisContractCatalog,
  parseEisContractRss,
  syncGovernmentProcurementSnapshot,
} from './sync-government-procurement-snapshot.mjs';
import { resolveActiveSnapshot } from './adapters/snapshot-activation.mjs';

const CATALOG_URL = 'https://zakupki.gov.ru/epz/opendata/search/results.html?dataset44IdHidden=5&pageNumber=1&recordsPerPage=_50';
const RSS_URL = 'https://zakupki.gov.ru/epz/contract/search/rss?searchType=false&morphology=on&fz44=on&pageNumber=1&recordsPerPage=_50&supplierTitle=7707083893';

test('EIS discovery accepts official contract passports and rejects off-host URLs', async () => {
  const html = `
    <a href="/epz/opendata/card/passport-info.html?passportId=7710568760-Contracts-Moskva">passport</a>
    <div class="registry-entry__body-value">Информация о контрактах (субъект РФ: г. Москва)</div>`;
  const fetchImpl = async (url) => {
    assert.equal(url, CATALOG_URL);
    return response(html, { url: CATALOG_URL });
  };
  const catalog = await discoverEisContractCatalog(fetchImpl);
  assert.equal(catalog.passports.length, 1);
  assert.deepEqual(catalog.passports[0], {
    passport_id: '7710568760-Contracts-Moskva',
    passport_url: 'https://zakupki.gov.ru/epz/opendata/card/passport-info.html?passportId=7710568760-Contracts-Moskva',
  });
  assert.equal(catalog.sha256, createHash('sha256').update(Buffer.from(html)).digest('hex'));
  assert.throws(() => assertOfficialEisUrl('https://example.com/contracts.xml'), /Invalid official EIS URL/);
});

test('EIS RSS parser produces company-level contract records only for the requested legal INN', () => {
  const records = parseEisContractRss(eisRssFixture(), {
    supplierInn: '7707083893',
    sourceUrl: RSS_URL,
  });
  assert.deepEqual(records, [{
    contract_number: '3621000294323000003',
    supplier_inn: '7707083893',
    supplier_name: null,
    customer_name: 'ФЕДЕРАЛЬНОЕ КАЗНАЧЕЙСТВО',
    contract_date: '2026-04-16',
    contract_value: 120600000.5,
    subject: null,
    source_url: 'https://zakupki.gov.ru/epz/contract/contractCard/common-info.html?reestrNumber=3621000294323000003',
    published_at: '2026-04-20T12:24:53.000Z',
    updated_at: '2026-08-07',
    status: 'Исполнение',
  }]);
  assert.throws(
    () => parseEisContractRss(eisRssFixture().replaceAll('7707083893', '1234567890'), {
      supplierInn: '7707083893', sourceUrl: RSS_URL,
    }),
    /did not echo the requested supplier INN/,
  );
});

test('EIS sync discovers catalog, downloads bounded RSS, checksums, stages, and activates', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rr-eis-sync-'));
  const rss = eisRssFixture();
  const fetchImpl = async (url) => {
    if (String(url).includes('/opendata/search/results.html')) {
      return response('<a href="/epz/opendata/card/passport-info.html?passportId=7710568760-Contracts-Moskva">x</a>', { url: CATALOG_URL });
    }
    assert.equal(url, RSS_URL);
    return response(rss, { url: RSS_URL, contentType: 'application/rss+xml;charset=UTF-8' });
  };
  try {
    const outputFile = join(directory, 'snapshot.json');
    const result = await syncGovernmentProcurementSnapshot({
      outputFile,
      trackedInns: ['7707083893'],
      fetchImpl,
      crawlDelayMs: 0,
      activationRootDirectory: directory,
    });
    assert.equal(result.snapshot.procurement.length, 1);
    assert.equal(result.snapshot.feeds[0].sha256, createHash('sha256').update(Buffer.from(rss)).digest('hex'));
    assert.equal(JSON.parse(readFileSync(outputFile, 'utf8')).procurement.length, 1);
    const active = resolveActiveSnapshot('government-procurement', { rootDirectory: directory });
    assert.equal(active.manifest.records, 1);
    assert.equal(active.manifest.source_urls.includes(RSS_URL), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('EIS sync applies the crawl-delay gate to retry requests', async () => {
  const requests = [];
  let catalogAttempts = 0;
  const fetchImpl = async (url) => {
    requests.push(Date.now());
    if (String(url).includes('/opendata/search/results.html')) {
      catalogAttempts += 1;
      if (catalogAttempts === 1) return response('not ready', { url: CATALOG_URL, status: 404 });
      return response('<a href="/epz/opendata/card/passport-info.html?passportId=7710568760-Contracts-Moskva">x</a>', { url: CATALOG_URL });
    }
    return response(eisRssFixture(), { url: RSS_URL, contentType: 'application/rss+xml;charset=UTF-8' });
  };

  await syncGovernmentProcurementSnapshot({
    outputFile: null,
    trackedInns: ['7707083893'],
    fetchImpl,
    crawlDelayMs: 25,
    activate: false,
    validateOnly: true,
  });

  assert.equal(requests.length, 3);
  assert.equal(requests[1] - requests[0] >= 20, true);
  assert.equal(requests[2] - requests[1] >= 20, true);
});

test('EIS snapshot rejects empty or cross-INN records', () => {
  assert.throws(() => buildGovernmentProcurementSnapshot({
    records: [{ supplier_inn: '1234567890' }],
    trackedInns: ['7707083893'],
    catalog: { source_url: CATALOG_URL, sha256: 'a'.repeat(64), bytes: 1, passports: 1 },
    feeds: [],
  }), /no validated contract records/);
});

function eisRssFixture() {
  return `<?xml version="1.0" encoding="utf-8"?>
  <rss version="2.0"><channel><title>Результаты поиска</title>
  <item><title>№ 3621000294323000003</title>
  <link>/epz/contract/contractCard/common-info.html?reestrNumber=3621000294323000003</link>
  <description>&lt;strong&gt;Параметры поиска: &lt;/strong&gt;&lt;br/&gt;&lt;strong&gt;Поставщик (исполнитель, подрядчик): &lt;/strong&gt;7707083893&lt;br/&gt;&lt;br/&gt;&lt;strong&gt;Найденный результат:&lt;/strong&gt;&lt;br/&gt;&lt;strong&gt;Номер реестровой записи контракта: &lt;/strong&gt;3621000294323000003&lt;br/&gt;&lt;strong&gt;Заказчик: &lt;/strong&gt;ФЕДЕРАЛЬНОЕ КАЗНАЧЕЙСТВО&lt;br/&gt;&lt;strong&gt;Контракт №: &lt;/strong&gt;72 от 16.04.2026&lt;br/&gt;&lt;strong&gt;Цена контракта: &lt;/strong&gt;120 600 000,50&lt;br/&gt;&lt;strong&gt; Валюта: &lt;/strong&gt;Российский рубль&lt;br/&gt;&lt;strong&gt;Статус контракта: &lt;/strong&gt;Исполнение&lt;br/&gt;&lt;strong&gt;Обновлено: &lt;/strong&gt;07.08.2026&lt;br/&gt;</description>
  <pubDate>Mon, 20 Apr 2026 12:24:53 GMT</pubDate><author>ФЕДЕРАЛЬНОЕ КАЗНАЧЕЙСТВО</author></item>
  </channel></rss>`;
}

function response(body, { url, contentType = 'text/html;charset=UTF-8', status = 200 }) {
  const result = new Response(body, { status, headers: { 'content-type': contentType } });
  Object.defineProperty(result, 'url', { value: url });
  return result;
}
