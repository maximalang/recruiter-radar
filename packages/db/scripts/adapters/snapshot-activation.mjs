import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

const DEFAULT_ROOT = resolve('packages/db/scripts/.snapshots');
const DEFAULT_RETENTION_COUNT = 3;
const VERSIONED_SNAPSHOT_NAME = /^snapshot-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/;

export function resolveActiveSnapshot(sourceId, { rootDirectory } = {}) {
  assertSnapshotSourceId(sourceId);
  const manifestPath = join(resolveSnapshotRoot(rootDirectory), sourceId, 'active.json');
  if (!existsSync(manifestPath)) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const snapshotPath = isAbsolute(manifest.snapshot_file)
    ? manifest.snapshot_file
    : resolve(dirname(manifestPath), manifest.snapshot_file);
  if (!existsSync(snapshotPath) || !statSync(snapshotPath).isFile()) {
    throw new Error(`${sourceId} active snapshot file is missing: ${snapshotPath}`);
  }
  const bytes = readFileSync(snapshotPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== manifest.sha256) {
    throw new Error(`${sourceId} active snapshot checksum mismatch.`);
  }
  return { snapshotPath, manifestPath, manifest };
}

export function resolveSnapshotInputFile(sourceId, envName, options = {}) {
  const override = process.env[envName]?.trim();
  if (override) return { inputFilePath: override, mode: 'override' };
  const active = resolveActiveSnapshot(sourceId, options);
  return active ? { inputFilePath: active.snapshotPath, mode: 'active-snapshot' } : null;
}

export function resolveVersionedSnapshotOutput(sourceId, now = new Date(), options = {}) {
  assertSnapshotSourceId(sourceId);
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return join(resolveSnapshotRoot(options.rootDirectory), sourceId, `snapshot-${timestamp}.json`);
}

export async function activateValidatedSnapshot({
  sourceId,
  snapshotFile,
  recordCount,
  sourceUrls = [],
  rootDirectory,
  retentionCount = process.env.SOURCE_SNAPSHOT_RETENTION_COUNT,
}) {
  assertSnapshotSourceId(sourceId);
  const normalizedRetentionCount = normalizeRetentionCount(retentionCount);
  const snapshotPath = resolve(snapshotFile);
  const bytes = await readFile(snapshotPath);
  if (!Number.isInteger(recordCount) || recordCount < 1) {
    throw new Error(`${sourceId} snapshot activation requires at least one validated record.`);
  }
  JSON.parse(bytes.toString('utf8'));
  const directory = join(resolveSnapshotRoot(rootDirectory), sourceId);
  await mkdir(directory, { recursive: true });
  const manifestPath = join(directory, 'active.json');
  const temporaryPath = join(directory, `.active.${process.pid}.tmp`);
  const manifest = {
    version: 1,
    source_id: sourceId,
    activated_at: new Date().toISOString(),
    snapshot_file: relativeSnapshotPath(directory, snapshotPath),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    records: recordCount,
    source_urls: sourceUrls,
  };
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await rename(temporaryPath, manifestPath);
  const retention = await pruneVersionedSnapshots({
    directory,
    activeSnapshotPath: snapshotPath,
    retentionCount: normalizedRetentionCount,
  });
  return { manifestPath, manifest, retention };
}

async function pruneVersionedSnapshots({ directory, activeSnapshotPath, retentionCount }) {
  const entries = await readdir(directory, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isFile() && VERSIONED_SNAPSHOT_NAME.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));
  const activeName = dirname(activeSnapshotPath) === directory ? basename(activeSnapshotPath) : null;
  const retained = new Set(candidates.slice(0, retentionCount));
  if (activeName && VERSIONED_SNAPSHOT_NAME.test(activeName)) retained.add(activeName);
  const removed = candidates.filter((name) => !retained.has(name));
  for (const name of removed) await unlink(join(directory, name));
  return { retained: candidates.filter((name) => retained.has(name)), removed };
}

function normalizeRetentionCount(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_RETENTION_COUNT;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 2 || parsed > 20) {
    throw new Error('SOURCE_SNAPSHOT_RETENTION_COUNT must be an integer between 2 and 20.');
  }
  return parsed;
}

function assertSnapshotSourceId(sourceId) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(sourceId)) throw new Error('Invalid snapshot source ID.');
}

function resolveSnapshotRoot(rootDirectory) {
  return resolve(rootDirectory ?? process.env.SOURCE_SNAPSHOT_ROOT?.trim() ?? DEFAULT_ROOT);
}

function relativeSnapshotPath(directory, snapshotPath) {
  return dirname(snapshotPath) === directory ? basename(snapshotPath) : snapshotPath;
}
