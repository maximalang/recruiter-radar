import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

const DEFAULT_ROOT = resolve('packages/db/scripts/.snapshots');

export function resolveActiveSnapshot(sourceId, { rootDirectory = DEFAULT_ROOT } = {}) {
  const manifestPath = join(resolve(rootDirectory), sourceId, 'active.json');
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

export async function activateValidatedSnapshot({
  sourceId,
  snapshotFile,
  recordCount,
  sourceUrls = [],
  rootDirectory = DEFAULT_ROOT,
}) {
  const snapshotPath = resolve(snapshotFile);
  const bytes = await readFile(snapshotPath);
  if (!Number.isInteger(recordCount) || recordCount < 1) {
    throw new Error(`${sourceId} snapshot activation requires at least one validated record.`);
  }
  JSON.parse(bytes.toString('utf8'));
  const directory = join(resolve(rootDirectory), sourceId);
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
  return { manifestPath, manifest };
}

function relativeSnapshotPath(directory, snapshotPath) {
  return dirname(snapshotPath) === directory ? basename(snapshotPath) : snapshotPath;
}
