#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { evaluateSourceProductionProof } from './adapters/source-production-proof.mjs';

const sourceArg = process.argv.find((arg) => arg.startsWith('--source='));
const maxAgeArg = process.argv.find((arg) => arg.startsWith('--max-age-hours='));
const jsonOutput = process.argv.includes('--json');
const inputArg = process.argv.find((arg) => !arg.startsWith('--') && arg !== process.argv[0] && arg !== process.argv[1]);

assert.ok(inputArg, 'Usage: verify-source-production-proof.mjs <proof.json> [--source=<id>] [--max-age-hours=168] [--json]');
const expectedSource = sourceArg?.slice('--source='.length).trim() || null;
const maxAgeHours = normalizeMaxAge(maxAgeArg?.slice('--max-age-hours='.length));
const proofPath = resolve(inputArg);
const proof = JSON.parse(readFileSync(proofPath, 'utf8').replace(/^\uFEFF/, ''));
const evaluation = evaluateSourceProductionProof(proof, { maxAgeHours });
const issues = [...evaluation.issues];

if (expectedSource && evaluation.source !== expectedSource) {
  issues.push(`source-mismatch:${evaluation.source ?? 'missing'}!=${expectedSource}`);
}

const report = Object.freeze({
  pass: issues.length === 0,
  source: evaluation.source,
  expectedSource,
  proofAt: evaluation.proofAt,
  maxAgeHours,
  issues: Object.freeze([...new Set(issues)]),
  proofPath,
});

if (jsonOutput) console.log(JSON.stringify(report));
else console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;

function normalizeMaxAge(value) {
  if (value === undefined) return 168;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 24 * 31) {
    throw new RangeError('--max-age-hours must be between 0 and 744 hours');
  }
  return parsed;
}
