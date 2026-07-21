#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultFixture = path.resolve(scriptDir, '../fixtures/fiur-evaluation.v1.json');

export function divide(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

export function roundMetric(value) {
  return value === null ? null : Math.round(value * 10_000) / 10_000;
}

export function scoreBand(score) {
  if (score >= 3.2) return 'hot';
  if (score >= 2.4) return 'warm';
  return 'cold';
}

export function validateDataset(dataset) {
  if (!dataset || dataset.schemaVersion !== 1) throw new Error('Unsupported evaluation schemaVersion.');
  if (typeof dataset.datasetVersion !== 'string' || dataset.datasetVersion.trim() === '') {
    throw new Error('datasetVersion is required.');
  }
  if (typeof dataset.scoringVersion !== 'string' || dataset.scoringVersion.trim() === '') {
    throw new Error('scoringVersion is required.');
  }
  if (!Array.isArray(dataset.items) || dataset.items.length === 0) {
    throw new Error('Evaluation dataset must contain items.');
  }

  const ids = new Set();
  for (const item of dataset.items) {
    if (!item || typeof item.id !== 'string' || item.id.trim() === '') throw new Error('Every item needs an id.');
    if (ids.has(item.id)) throw new Error(`Duplicate item id: ${item.id}`);
    ids.add(item.id);
    if (!item.prediction || !Number.isFinite(item.prediction.rank) || !Number.isFinite(item.prediction.score)) {
      throw new Error(`Invalid prediction for ${item.id}`);
    }
    if (!['A', 'B', 'C', 'D'].includes(item.prediction.gate)) throw new Error(`Invalid gate for ${item.id}`);
    if (typeof item.prediction.shouldContact !== 'boolean') throw new Error(`Missing prediction label for ${item.id}`);
    const requiredLabels = [
      'entityMatch',
      'actualHiring',
      'fresh',
      'icpFit',
      'evidenceIndependent',
      'lawfulContactPath',
      'shouldContact',
    ];
    for (const label of requiredLabels) {
      if (typeof item.labels?.[label] !== 'boolean') throw new Error(`Missing ${label} label for ${item.id}`);
    }
    if (!Array.isArray(item.sourceFamilies) || item.sourceFamilies.some((source) => typeof source !== 'string')) {
      throw new Error(`Invalid sourceFamilies for ${item.id}`);
    }
  }
  return dataset;
}

function precisionAt(items, k) {
  const ranked = [...items].sort((a, b) => a.prediction.rank - b.prediction.rank).slice(0, k);
  return roundMetric(divide(ranked.filter((item) => item.labels.shouldContact).length, ranked.length));
}

function group(items, keyFn) {
  const grouped = new Map();
  for (const item of items) {
    const key = keyFn(item);
    const bucket = grouped.get(key) ?? [];
    bucket.push(item);
    grouped.set(key, bucket);
  }
  return grouped;
}

function summarizeOutcomes(items) {
  const result = {};
  for (const item of items) {
    const outcome = item.outcome ?? 'none';
    result[outcome] = (result[outcome] ?? 0) + 1;
  }
  return result;
}

export function evaluateDataset(rawDataset) {
  const dataset = validateDataset(rawDataset);
  const items = dataset.items;
  const predictedPositive = items.filter((item) => item.prediction.shouldContact);
  const falsePositives = predictedPositive.filter((item) => !item.labels.shouldContact);
  const entityErrors = items.filter((item) => !item.labels.entityMatch);

  const gateCalibration = {};
  for (const [gate, gateItems] of group(items, (item) => item.prediction.gate)) {
    gateCalibration[gate] = {
      count: gateItems.length,
      predictedContactRate: roundMetric(divide(
        gateItems.filter((item) => item.prediction.shouldContact).length,
        gateItems.length,
      )),
      labeledContactRate: roundMetric(divide(
        gateItems.filter((item) => item.labels.shouldContact).length,
        gateItems.length,
      )),
      entityMatchRate: roundMetric(divide(
        gateItems.filter((item) => item.labels.entityMatch).length,
        gateItems.length,
      )),
      actualHiringRate: roundMetric(divide(
        gateItems.filter((item) => item.labels.actualHiring).length,
        gateItems.length,
      )),
    };
  }

  const sourceCoverage = {};
  for (const item of items) {
    for (const source of new Set(item.sourceFamilies)) {
      sourceCoverage[source] = (sourceCoverage[source] ?? 0) + 1;
    }
  }

  const outcomesByScoreBand = {};
  for (const [band, bandItems] of group(items, (item) => scoreBand(item.prediction.score))) {
    outcomesByScoreBand[band] = {
      count: bandItems.length,
      outcomes: summarizeOutcomes(bandItems),
      labeledContactRate: roundMetric(divide(
        bandItems.filter((item) => item.labels.shouldContact).length,
        bandItems.length,
      )),
    };
  }

  const outcomesByGate = {};
  for (const [gate, gateItems] of group(items, (item) => item.prediction.gate)) {
    outcomesByGate[gate] = {
      count: gateItems.length,
      outcomes: summarizeOutcomes(gateItems),
    };
  }

  return {
    schemaVersion: dataset.schemaVersion,
    datasetVersion: dataset.datasetVersion,
    scoringVersion: dataset.scoringVersion,
    generatedAt: 'deterministic-fixture',
    sampleSize: items.length,
    disclaimer: 'Fixture metrics validate the harness only. They are not production quality claims.',
    metrics: {
      precisionAt3: precisionAt(items, 3),
      precisionAt5: precisionAt(items, 5),
      falsePositiveRate: roundMetric(divide(falsePositives.length, predictedPositive.length)),
      entityResolutionErrorRate: roundMetric(divide(entityErrors.length, items.length)),
      actualHiringRate: roundMetric(divide(items.filter((item) => item.labels.actualHiring).length, items.length)),
      freshSignalRate: roundMetric(divide(items.filter((item) => item.labels.fresh).length, items.length)),
      evidenceIndependenceRate: roundMetric(divide(
        items.filter((item) => item.labels.evidenceIndependent).length,
        items.length,
      )),
      lawfulContactPathRate: roundMetric(divide(
        items.filter((item) => item.labels.lawfulContactPath).length,
        items.length,
      )),
    },
    gateCalibration,
    sourceCoverage: Object.fromEntries(Object.entries(sourceCoverage).sort(([a], [b]) => a.localeCompare(b))),
    outcomesByScoreBand,
    outcomesByGate,
  };
}

export function loadDataset(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseArgs(argv) {
  const args = { fixture: defaultFixture, format: 'json' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--fixture') {
      if (!argv[i + 1]) throw new Error('--fixture requires a path.');
      args.fixture = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
    } else if (argv[i] === '--format') {
      if (!['json', 'markdown'].includes(argv[i + 1])) throw new Error('--format must be json or markdown.');
      args.format = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  return args;
}

function toMarkdown(report) {
  const lines = [
    '# FIUR quality evaluation',
    '',
    `- Dataset: \`${report.datasetVersion}\``,
    `- Scoring: \`${report.scoringVersion}\``,
    `- Sample: ${report.sampleSize}`,
    `- Disclaimer: ${report.disclaimer}`,
    '',
    '| Metric | Value |',
    '|---|---:|',
  ];
  for (const [name, value] of Object.entries(report.metrics)) {
    lines.push(`| ${name} | ${value ?? 'n/a'} |`);
  }
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = evaluateDataset(loadDataset(args.fixture));
    process.stdout.write(args.format === 'markdown' ? toMarkdown(report) : `${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`FIUR evaluation failed: ${message}`);
    process.exitCode = 1;
  }
}
