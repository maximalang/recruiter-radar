import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { activateValidatedSnapshot, resolveActiveSnapshot, resolveVersionedSnapshotOutput } from './snapshot-activation.mjs';

test('snapshot activation validates, checksums, and atomically resolves active data', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rr-snapshot-'));
  try {
    const snapshotFile = join(directory, 'fns-2026-08-13.json');
    writeFileSync(snapshotFile, '{"fns":[{"inn":"7700000000"}]}\n');
    const activated = await activateValidatedSnapshot({
      sourceId: 'fns-open-data',
      snapshotFile,
      recordCount: 1,
      sourceUrls: ['https://data.nalog.ru/opendata/'],
      rootDirectory: directory,
    });
    assert.equal(activated.manifest.records, 1);
    assert.equal(activated.manifest.sha256.length, 64);
    const active = resolveActiveSnapshot('fns-open-data', { rootDirectory: directory });
    assert.equal(active.snapshotPath, snapshotFile);
    writeFileSync(snapshotFile, '{"fns":[]}\n');
    assert.throws(
      () => resolveActiveSnapshot('fns-open-data', { rootDirectory: directory }),
      /checksum mismatch/,
    );
    assert.equal(JSON.parse(readFileSync(activated.manifestPath, 'utf8')).records, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('snapshot activation rejects empty or invalid snapshots before manifest swap', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rr-snapshot-invalid-'));
  try {
    const snapshotFile = join(directory, 'invalid.json');
    writeFileSync(snapshotFile, 'not json');
    await assert.rejects(
      () => activateValidatedSnapshot({
        sourceId: 'rosstat-open-data',
        snapshotFile,
        recordCount: 1,
        rootDirectory: directory,
      }),
      /JSON/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('uses SOURCE_SNAPSHOT_ROOT for production activation without per-source input files', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rr-snapshot-root-'));
  const previousRoot = process.env.SOURCE_SNAPSHOT_ROOT;
  process.env.SOURCE_SNAPSHOT_ROOT = directory;
  try {
    const snapshotFile = join(directory, 'rospatent.json');
    assert.equal(
      resolveVersionedSnapshotOutput('rospatent-open-data', new Date('2026-08-13T10:05:18.123Z')),
      join(directory, 'rospatent-open-data', 'snapshot-2026-08-13T10-05-18-123Z.json'),
    );
    writeFileSync(snapshotFile, '{"rospatent":[{"record_id":"1"}]}\n');
    const activated = await activateValidatedSnapshot({
      sourceId: 'rospatent-open-data',
      snapshotFile,
      recordCount: 1,
    });
    assert.equal(activated.manifestPath, join(directory, 'rospatent-open-data', 'active.json'));
    assert.equal(resolveActiveSnapshot('rospatent-open-data').snapshotPath, snapshotFile);
  } finally {
    if (previousRoot === undefined) delete process.env.SOURCE_SNAPSHOT_ROOT;
    else process.env.SOURCE_SNAPSHOT_ROOT = previousRoot;
    rmSync(directory, { recursive: true, force: true });
  }
});
