import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  assertOfficialRosstatDatasetUrl,
  buildRosstatSnapshot,
  discoverLatestRosstatDataset,
  parseRosstatAggregateCsv,
  syncRosstatOpenDataSnapshot,
} from './sync-rosstat-open-data-snapshot.mjs';
import { resolveActiveSnapshot } from './adapters/snapshot-activation.mjs';

const LIST_URL = 'https://rosstat.gov.ru/opendata/list.csv';
const META_URL = 'https://rosstat.gov.ru/opendata/7708234640-unemploymentrate6/meta.csv';
const DATA_URL = 'https://rosstat.gov.ru/opendata/7708234640-unemploymentrate6/data-20260530T1605-structure-20260530T1605.csv';

test('Rosstat catalog discovery chooses the newest non-archive regional unemployment dataset', async () => {
  const fetchImpl = async (url) => {
    if (url === LIST_URL) return response([
      'property,title,value,format',
      '7708234640-unemploymentrate4,"Уровень безработицы населения в возрасте 15 лет и старше по субъектам Российской Федерации в I квартале 2025 г.",https://rosstat.gov.ru/opendata/7708234640-unemploymentrate4/meta.csv,csv',
      '7708234640-unemploymentrate6,"Уровень безработицы населения в возрасте 15 лет и старше по субъектам Российской Федерации в I квартале 2026 г.",https://rosstat.gov.ru/opendata/7708234640-unemploymentrate6/meta.csv,csv',
      '7708234640-unemploymentrate1,"(Архив) Уровень безработицы населения в возрасте 15 лет и старше",https://rosstat.gov.ru/opendata/7708234640-unemploymentrate1/meta.csv,csv',
    ].join('\n'), { url: LIST_URL });
    if (url.endsWith('unemploymentrate4/meta.csv')) return response(meta('7708234640-unemploymentrate4', '20250530', DATA_URL.replace('rate6', 'rate4')), { url });
    assert.equal(url, META_URL);
    return response(meta('7708234640-unemploymentrate6', '20260530', DATA_URL), { url, windows1251: true });
  };
  const dataset = await discoverLatestRosstatDataset(fetchImpl);
  assert.equal(dataset.dataset_id, '7708234640-unemploymentrate6');
  assert.equal(dataset.data_url, DATA_URL);
  assert.equal(dataset.period, '2026-Q1');
  assert.throws(() => assertOfficialRosstatDatasetUrl('https://example.com/data.csv'), /Invalid official Rosstat dataset URL/);
});

test('Rosstat parser emits aggregate-only regional context records', () => {
  const records = parseRosstatAggregateCsv('territories;indicators\nРоссийская Федерация;2,2\nг. Москва;1,0\n', {
    dataset: { dataset_id: '7708234640-unemploymentrate6', data_url: DATA_URL, title: 'Уровень безработицы', period: '2026-Q1', published_at: '2026-05-30' },
  });
  assert.deepEqual(records, [
    {
      dataset_id: '7708234640-unemploymentrate6', record_id: '2026-Q1:rossiiskaia-federatsiia',
      title: 'Уровень безработицы — Российская Федерация', period: '2026-Q1', region: 'Российская Федерация',
      indicator: 'unemployment_rate', value: 2.2, unit: 'percent', aggregation_scope: 'federal', source_url: DATA_URL, published_at: '2026-05-30',
    },
    {
      dataset_id: '7708234640-unemploymentrate6', record_id: '2026-Q1:g-moskva',
      title: 'Уровень безработицы — г. Москва', period: '2026-Q1', region: 'г. Москва',
      indicator: 'unemployment_rate', value: 1, unit: 'percent', aggregation_scope: 'region', source_url: DATA_URL, published_at: '2026-05-30',
    },
  ]);
  assert.equal(records.some((record) => 'inn' in record || 'company_name' in record), false);
});

test('Rosstat sync downloads, validates, checksums, stages, and activates the aggregate dataset', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rr-rosstat-sync-'));
  const data = 'territories;indicators\nРоссийская Федерация;2,2\nг. Москва;1,0\n';
  const fetchImpl = async (url) => {
    if (url === LIST_URL) return response(`property,title,value,format\n7708234640-unemploymentrate6,"Уровень безработицы населения в возрасте 15 лет и старше по субъектам Российской Федерации в I квартале 2026 г.",${META_URL},csv\n`, { url });
    if (url === META_URL) return response(meta('7708234640-unemploymentrate6', '20260530', DATA_URL), { url, windows1251: true });
    assert.equal(url, DATA_URL);
    return response(data, { url, contentType: 'text/plain;charset=UTF-8' });
  };
  try {
    const outputFile = join(directory, 'snapshot.json');
    const result = await syncRosstatOpenDataSnapshot({ outputFile, fetchImpl, activationRootDirectory: directory });
    assert.equal(result.snapshot.rosstat.length, 2);
    assert.equal(result.snapshot.dataset.sha256, createHash('sha256').update(Buffer.from(data)).digest('hex'));
    assert.equal(JSON.parse(readFileSync(outputFile, 'utf8')).rosstat.length, 2);
    const active = resolveActiveSnapshot('rosstat-open-data', { rootDirectory: directory });
    assert.equal(active.manifest.records, 2);
    assert.deepEqual(active.manifest.source_urls, [DATA_URL]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Rosstat snapshot rejects empty or company-attributed records', () => {
  assert.throws(() => buildRosstatSnapshot({ records: [{ inn: '7707083893' }], dataset: {
    dataset_id: '7708234640-unemploymentrate6', data_url: DATA_URL, sha256: 'a'.repeat(64), bytes: 1,
  } }), /no validated aggregate records/);
});

function meta(id, modified, dataUrl) {
  return [
    'property,value', `identifier,${id}`,
    'title,"Уровень безработицы населения в возрасте 15 лет и старше по субъектам Российской Федерации в I квартале 2026 г."',
    `modified,${modified}`,
    `data-20260530T1605-structure-20260530T1605.csv,${dataUrl}`,
  ].join('\n');
}

function response(body, { url, contentType = 'text/csv;charset=UTF-8', windows1251 = false }) {
  const bytes = windows1251 ? encodeWindows1251(body) : body;
  const value = new Response(bytes, { status: 200, headers: { 'content-type': contentType } });
  Object.defineProperty(value, 'url', { value: url });
  return value;
}

function encodeWindows1251(value) {
  const table = new TextDecoder('windows-1251').decode(Uint8Array.from({ length: 256 }, (_, index) => index));
  return Uint8Array.from(value, (char) => {
    const index = table.indexOf(char);
    if (index < 0) throw new Error(`Fixture character is not representable in windows-1251: ${char}`);
    return index;
  });
}
