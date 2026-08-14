import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

test('retains the active snapshot and two rollback versions after activation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rr-snapshot-retention-'));
  const sourceDirectory = join(directory, 'fns-open-data');
  mkdirSync(sourceDirectory, { recursive: true });
  const names = [
    'snapshot-2026-08-09T10-00-00-000Z.json',
    'snapshot-2026-08-10T10-00-00-000Z.json',
    'snapshot-2026-08-11T10-00-00-000Z.json',
    'snapshot-2026-08-12T10-00-00-000Z.json',
    'snapshot-2026-08-13T10-00-00-000Z.json',
  ];
  try {
    for (const name of names) writeFileSync(join(sourceDirectory, name), '{"fns":[{"inn":"7700000000"}]}\n');
    const activeSnapshot = join(sourceDirectory, names.at(-1));
    const activated = await activateValidatedSnapshot({
      sourceId: 'fns-open-data',
      snapshotFile: activeSnapshot,
      recordCount: 1,
      rootDirectory: directory,
    });
    assert.deepEqual(activated.retention.retained, names.slice(-3).reverse());
    assert.deepEqual(activated.retention.removed, names.slice(0, 2).reverse());
    assert.equal(existsSync(activeSnapshot), true);
    assert.equal(existsSync(join(sourceDirectory, names[0])), false);
    assert.equal(resolveActiveSnapshot('fns-open-data', { rootDirectory: directory }).snapshotPath, activeSnapshot);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects unsafe source IDs and invalid retention before deleting anything', async () => {
  assert.throws(() => resolveActiveSnapshot('../outside'), /Invalid snapshot source ID/);
  const directory = mkdtempSync(join(tmpdir(), 'rr-snapshot-retention-invalid-'));
  try {
    const snapshotFile = join(directory, 'snapshot.json');
    writeFileSync(snapshotFile, '{"fns":[{"inn":"7700000000"}]}\n');
    await assert.rejects(
      () => activateValidatedSnapshot({
        sourceId: 'fns-open-data',
        snapshotFile,
        recordCount: 1,
        rootDirectory: directory,
        retentionCount: 1,
      }),
      /between 2 and 20/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
