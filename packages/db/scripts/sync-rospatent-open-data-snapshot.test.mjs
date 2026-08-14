import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  assertOfficialRospatentDatasetUrl,
  buildRospatentSnapshot,
  discoverLatestRospatentDatasetUrl,
  parseRospatentCsvStream,
  syncRospatentOpenDataSnapshot,
} from './sync-rospatent-open-data-snapshot.mjs';
import { resolveActiveSnapshot } from './adapters/snapshot-activation.mjs';

const DATASET_URL = 'https://rospatent.gov.ru/opendata/7730176088-tz/data-20260805-structure-20180828.csv';

test('Rospatent discovery accepts only the current official trademark dataset URL', async () => {
  const fetchImpl = async (url) => {
    assert.equal(url, 'https://rospatent.gov.ru/opendata/7730176088-tz/meta.csv');
    return new Response([
      'property;value',
      'identifier;7730176088-tz',
      `data-20260805-structure-20180828;${DATASET_URL}`,
      'structure-20180828;https://rospatent.gov.ru/opendata/7730176088-tz/structure-20180828.csv',
    ].join('\n'), { status: 200, headers: { 'content-type': 'text/csv;charset=UTF-8' } });
  };
  assert.equal(await discoverLatestRospatentDatasetUrl(fetchImpl), DATASET_URL);
  assert.throws(
    () => assertOfficialRospatentDatasetUrl('https://example.com/data.csv'),
    /Invalid official Rospatent trademark dataset URL/,
  );
});

test('Rospatent CSV parser streams quoted multiline rows and keeps only tracked legal entities', async () => {
  const csv = [
    'registration number,registration date,application number,application date,right holder name,right holder inn,actual,publication URL',
    '100,20260102,200,20250102,"ООО ""Альфа, Север""",7707083893,true,http://www1.fips.ru/fips_servl/fips_servlet?DocNumber=100',
    '101,20260103,201,20250103,"ООО ""Строка\nДва""",7707083893,true,http://www1.fips.ru/fips_servl/fips_servlet?DocNumber=101',
    '102,20260104,202,20250104,ООО Бета,7700000000,true,http://www1.fips.ru/fips_servl/fips_servlet?DocNumber=102',
  ].join('\n');
  const records = await parseRospatentCsvStream(Readable.from(chunk(csv, 13)), {
    sourceUrl: DATASET_URL,
    trackedInns: ['7707083893'],
  });
  assert.equal(records.length, 2);
  assert.deepEqual(records[0], {
    applicant_inn: '7707083893',
    applicant_name: 'ООО "Альфа, Север"',
    record_id: '100',
    application_number: '200',
    record_type: 'trademark',
    title: 'Trademark registration 100',
    application_date: '2025-01-02',
    registration_date: '2026-01-02',
    source_url: DATASET_URL,
  });
  assert.equal(records[1].applicant_name, 'ООО "Строка\nДва"');
});

test('Rospatent sync discovers, range-downloads, validates, checksums, and atomically activates', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rr-rospatent-sync-'));
  const csv = Buffer.from([
    'registration number,registration date,application number,application date,right holder name,right holder inn,actual,publication URL',
    '100,20260102,200,20250102,ООО Альфа,7707083893,true,http://www1.fips.ru/fips_servl/fips_servlet?DocNumber=100',
  ].join('\n'));
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith('/meta.csv')) {
      return new Response(`property;value\ndata-20260805-structure-20180828;${DATASET_URL}\n`, { status: 200 });
    }
    if (options.method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: { 'content-length': String(csv.length), etag: '"fixture"', 'last-modified': 'Wed, 05 Aug 2026 07:23:35 GMT' },
      });
    }
    const range = /^bytes=(\d+)-(\d+)$/.exec(options.headers?.range);
    assert.ok(range);
    const start = Number(range[1]);
    const end = Number(range[2]);
    return new Response(csv.subarray(start, end + 1), {
      status: 206,
      headers: { 'content-range': `bytes ${start}-${end}/${csv.length}` },
    });
  };
  try {
    const outputFile = join(directory, 'rospatent-2026-08-13.json');
    const result = await syncRospatentOpenDataSnapshot({
      outputFile,
      trackedInns: ['7707083893'],
      fetchImpl,
      rangeBytes: 31,
      activationRootDirectory: directory,
    });
    assert.equal(result.snapshot.rospatent.length, 1);
    assert.equal(result.snapshot.dataset.sha256, createHash('sha256').update(csv).digest('hex'));
    assert.equal(result.snapshot.dataset.bytes, csv.length);
    assert.equal(JSON.parse(readFileSync(outputFile, 'utf8')).rospatent.length, 1);
    const active = resolveActiveSnapshot('rospatent-open-data', { rootDirectory: directory });
    assert.equal(active.manifest.records, 1);
    assert.equal(active.manifest.source_urls[0], DATASET_URL);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Rospatent snapshot refuses unvalidated records', () => {
  assert.throws(
    () => buildRospatentSnapshot({
      records: [{ applicant_inn: 'bad' }],
      trackedInns: ['7707083893'],
      dataset: { source_url: DATASET_URL, sha256: 'a'.repeat(64), bytes: 1 },
    }),
    /no deterministically validated records/,
  );
});

test('Rospatent validate-only consumes and checksums without writing or activating', async () => {
  const csv = Buffer.from([
    'registration number,registration date,application number,application date,right holder name,right holder inn',
    '100,20260102,200,20250102,ООО Альфа,7707083893',
  ].join('\n'));
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith('/meta.csv')) return new Response(`property;value\ndata;${DATASET_URL}\n`);
    if (options.method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-length': String(csv.length) } });
    const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(options.headers.range);
    return new Response(csv.subarray(Number(start), Number(end) + 1), {
      status: 206,
      headers: { 'content-range': `bytes ${start}-${end}/${csv.length}` },
    });
  };
  const result = await syncRospatentOpenDataSnapshot({
    trackedInns: ['7707083893'],
    fetchImpl,
    rangeBytes: 23,
    validateOnly: true,
  });
  assert.equal(result.validatedOnly, true);
  assert.equal(result.outputFile, null);
  assert.equal(result.activation, null);
  assert.equal(result.snapshot.rospatent.length, 1);
});

function* chunk(value, length) {
  for (let index = 0; index < value.length; index += length) yield value.slice(index, index + length);
}
