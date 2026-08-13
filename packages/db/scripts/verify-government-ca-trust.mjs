import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { fetchWithSourcePolicy } from './adapters/source-http.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const certificateDir = resolve(scriptDir, '../certs');
const rootPath = join(certificateDir, 'russian-trusted-root-ca.pem');
const intermediatePath = join(certificateDir, 'russian-trusted-sub-ca-2024.pem');

const EXPECTED_ROOT_FINGERPRINT = 'D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31';
const EXPECTED_INTERMEDIATE_FINGERPRINT = '21:55:78:50:36:C9:00:DB:B5:F1:BB:2A:15:69:C8:0C:55:59:5B:D6:BF:94:86:7A:29:BB:DD:BC:7D:88:A3:F2';
const LIVE_ENDPOINTS = [
  'https://zakupki.gov.ru/epz/opendata/search/results.html',
  'https://rosstat.gov.ru/opendata/',
];

/**
 * Certificates are published by the official Gosuslugi TLS instructions:
 * https://www.gosuslugi.ru/crt
 */
export function verifyGovernmentCaCertificates() {
  const root = new X509Certificate(readFileSync(rootPath));
  const intermediate = new X509Certificate(readFileSync(intermediatePath));

  assert.equal(root.fingerprint256, EXPECTED_ROOT_FINGERPRINT, 'Unexpected Russian Trusted Root CA fingerprint.');
  assert.equal(intermediate.fingerprint256, EXPECTED_INTERMEDIATE_FINGERPRINT, 'Unexpected Russian Trusted Sub CA 2024 fingerprint.');
  assert.equal(root.ca, true);
  assert.equal(intermediate.ca, true);
  assert.equal(root.checkIssued(root), true);
  assert.equal(root.verify(root.publicKey), true);
  assert.equal(intermediate.checkIssued(root), true);
  assert.equal(intermediate.verify(root.publicKey), true);

  const now = Date.now();
  for (const certificate of [root, intermediate]) {
    assert.ok(Date.parse(certificate.validFrom) <= now, `${certificate.subject} is not valid yet.`);
    assert.ok(Date.parse(certificate.validTo) > now, `${certificate.subject} is expired.`);
  }

  return {
    root: { fingerprint256: root.fingerprint256, validTo: root.validTo },
    intermediate: { fingerprint256: intermediate.fingerprint256, validTo: intermediate.validTo },
  };
}

export async function verifyGovernmentCaLiveTrust() {
  verifyGovernmentCaCertificates();
  const directory = await mkdtemp(join(tmpdir(), 'rr-government-ca-'));
  const bundlePath = join(directory, 'russian-trusted-ca-bundle.pem');
  try {
    const bundle = `${readFileSync(rootPath, 'utf8').trim()}\n${readFileSync(intermediatePath, 'utf8').trim()}\n`;
    await writeFile(bundlePath, bundle, { encoding: 'utf8', flag: 'wx' });
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--live-child'], {
      encoding: 'utf8',
      env: { ...process.env, NODE_EXTRA_CA_CERTS: bundlePath },
      timeout: 60_000,
      windowsHide: true,
    });
    if (child.error) throw child.error;
    if (child.status !== 0) throw new Error(child.stderr.trim() || `Government CA live verifier exited ${child.status}.`);
    return JSON.parse(child.stdout);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function runLiveChild() {
  const results = [];
  for (const url of LIVE_ENDPOINTS) {
    const response = await fetchWithSourcePolicy(url, {
      redirect: 'manual',
      timeoutMs: 20_000,
      retries: 0,
      sourceName: 'government-ca-verifier',
      headers: { 'user-agent': 'RecruiterRadar/1.0 (government-ca-verifier)' },
    });
    await response.body?.cancel();
    results.push({ url, status: response.status, location: response.headers.get('location') });
  }
  return { ok: true, nodeExtraCaCertificates: true, results };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--live-child')) {
    console.log(JSON.stringify(await runLiveChild()));
  } else {
    const certificates = verifyGovernmentCaCertificates();
    const live = process.argv.includes('--certificates-only') ? null : await verifyGovernmentCaLiveTrust();
    console.log(JSON.stringify({ ok: true, certificates, live }, null, 2));
  }
}
