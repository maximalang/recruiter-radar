#!/usr/bin/env node
/**
 * Techstack enrichment PILOT demo runner — MANUAL ONLY (never runs in CI).
 *
 * Runs the real local webstack-scanner (SPEC-enrichment-pilot.md demo batch)
 * through the production module `lib/techstack/techstack-enrichment.ts`, so
 * the demo exercises the exact guards that ship: feature flag, sequential
 * scans, >=1 s delay, <=200-domain cap, fail-closed error-evidence.
 *
 * The module is TypeScript; this runner consumes a one-off CommonJS compile:
 *
 *   node apps/web/node_modules/typescript/bin/tsc \
 *     apps/web/lib/techstack/techstack-enrichment.ts \
 *     --outDir artifacts/techstack-pilot/build --module commonjs \
 *     --target es2022 --moduleResolution node10 --esModuleInterop --skipLibCheck
 *
 * Usage (from the repo root):
 *   node apps/web/scripts/run-techstack-pilot.mjs \
 *     [--domains apps/web/scripts/techstack-pilot-domains.txt] \
 *     [--skipped apps/web/scripts/techstack-pilot-skipped.txt] \
 *     [--out artifacts/techstack-pilot/results.jsonl] \
 *     [--build artifacts/techstack-pilot/build]
 *
 * Output: results.jsonl (one line per scanned domain: raw scanner result +
 * mapped evidence) and summary.json / summary.md (share of domains with >=1
 * tool, top-10 tools, total time, failures and documented skips).
 * Company-level data only — no personal contacts are read or written.
 */

import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '../../..')

function parseArgs(argv) {
  const args = {
    domains: 'apps/web/scripts/techstack-pilot-domains.txt',
    skipped: 'apps/web/scripts/techstack-pilot-skipped.txt',
    out: 'artifacts/techstack-pilot/results.jsonl',
    build: 'artifacts/techstack-pilot/build',
  }
  for (let i = 0; i < argv.length; i += 1) {
    const name = argv[i]
    if (name.startsWith('--') && Object.prototype.hasOwnProperty.call(args, name.slice(2))) {
      args[name.slice(2)] = argv[i + 1]
      i += 1
    }
  }
  return args
}

function toRepoPath(value) {
  return isAbsolute(value) ? value : join(repoRoot, value)
}

function readDomainLines(file) {
  const lines = []
  for (const raw of readFileSync(file, 'utf-8').split(/\r?\n/)) {
    const withoutComment = raw.split('#')[0].trim()
    if (withoutComment.length > 0) lines.push(withoutComment)
  }
  return lines
}

function readSkippedEntries(file) {
  if (!existsSync(file)) return []
  const entries = []
  for (const raw of readFileSync(file, 'utf-8').split(/\r?\n/)) {
    const trimmed = raw.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue
    const [domain, ...rest] = trimmed.split('#')
    entries.push({ domain: domain.trim(), reason: rest.join('#').trim() || 'skipped by policy' })
  }
  return entries
}

const args = parseArgs(process.argv.slice(2))
const domainsFile = toRepoPath(args.domains)
const outPath = toRepoPath(args.out)
const modulePath = join(toRepoPath(args.build), 'techstack', 'techstack-enrichment.js')

if (!existsSync(modulePath)) {
  console.error(`compiled module not found: ${modulePath}`)
  console.error('run the tsc compile command from this file header first')
  process.exit(2)
}

const require = createRequire(import.meta.url)
const mod = require(modulePath)

const domains = readDomainLines(domainsFile)
const skippedByPolicy = readSkippedEntries(toRepoPath(args.skipped))

// The demo is an intentional, operator-launched run: enable the flag
// explicitly instead of depending on ambient env.
const config = mod.loadTechstackConfig({ ...process.env, TECHSTACK_ENRICHMENT_ENABLED: 'true' })
console.log(
  `[pilot] flag=${config.enabled} domains=${domains.length} delay>=${config.minDelayMs}ms cap=${config.maxDomainsPerRun} timeout=${config.timeoutMs}ms retries=${config.maxRetries}`,
)

const wallStartedAt = Date.now()
const report = await mod.enrichDomainsWithTechstack(domains, config)
const wallMs = Date.now() - wallStartedAt

mkdirSync(dirname(outPath), { recursive: true })

const jsonl = report.results
  .map((entry) => {
    const raw = entry.outcome.raw ?? {}
    return JSON.stringify({
      domain: entry.domain,
      status: entry.outcome.status,
      http_status: raw.http_status ?? null,
      scanned_at: raw.scanned_at ?? entry.outcome.startedAt,
      elapsed_ms: raw.elapsed_ms ?? entry.outcome.elapsedMs,
      attempts: entry.outcome.attempts,
      tool_count: entry.evidence.filter((record) => record.tool !== null).length,
      tools: (raw.tools ?? []).map((tool) => ({
        name: tool.name,
        confidence: tool.confidence,
        version: tool.version,
        categories: tool.categories,
        sources: tool.sources,
      })),
      fetch_error: raw.fetch_error ?? entry.outcome.error,
      evidence: entry.evidence,
    })
  })
  .join('\n')
writeFileSync(outPath, jsonl.length > 0 ? `${jsonl}\n` : '', 'utf-8')

// ---- summary ------------------------------------------------------------
const toolFrequency = new Map()
for (const entry of report.results) {
  for (const record of entry.evidence) {
    if (record.tool === null) continue
    toolFrequency.set(record.tool, (toolFrequency.get(record.tool) ?? 0) + 1)
  }
}
const topTools = [...toolFrequency.entries()]
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .slice(0, 10)
  .map(([tool, count]) => ({ tool, domains: count }))

const failures = report.results
  .filter((entry) => entry.outcome.status !== 'ok')
  .map((entry) => ({
    domain: entry.domain,
    status: entry.outcome.status,
    attempts: entry.outcome.attempts,
    error: (entry.outcome.error ?? '').slice(0, 160),
  }))

const share =
  report.scannedCount > 0
    ? Math.round((report.domainsWithTools / report.scannedCount) * 1000) / 10
    : 0

const summary = {
  pilot: 'rr-techstack-enrichment',
  ran_at: new Date().toISOString(),
  scanner: 'webstack-scanner (local, enthec/webappanalyzer data)',
  requested_domains: report.requestedCount,
  scanned_domains: report.scannedCount,
  domains_with_tools: report.domainsWithTools,
  share_with_tools_pct: share,
  tool_evidence_records: report.toolEvidenceCount,
  error_evidence_records: report.errorEvidenceCount,
  truncated: report.truncated,
  total_wall_ms: wallMs,
  module_total_elapsed_ms: report.totalElapsedMs,
  top_tools: topTools,
  failures,
  skipped_by_policy: skippedByPolicy,
  guard: {
    sequential: true,
    min_delay_ms: config.minDelayMs,
    timeout_ms: config.timeoutMs,
    max_retries: config.maxRetries,
    max_domains_per_run: config.maxDomainsPerRun,
  },
  results_file: args.out,
}
writeFileSync(join(dirname(outPath), 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf-8')

const md = [
  '# Techstack enrichment pilot — demo summary',
  '',
  `- Прогон: ${summary.ran_at}, сканер: локальный webstack-scanner ( последовательные запросы, delay ≥ ${config.minDelayMs} мс ).`,
  `- Доменов запрошено: ${report.requestedCount}; просканировано: ${report.scannedCount}; с ≥1 инструментом: ${report.domainsWithTools} (${share}%).`,
  `- Evidence-записей: инструментов ${report.toolEvidenceCount}, error-evidence ${report.errorEvidenceCount}.`,
  `- Суммарное время: ${(wallMs / 1000).toFixed(1)} с (стена), ${(report.totalElapsedMs / 1000).toFixed(1)} с (модуль).`,
  '',
  '## Топ-10 инструментов',
  '',
  '| инструмент | доменов |',
  '|---|---|',
  ...topTools.map((entry) => `| ${entry.tool} | ${entry.domains} |`),
  '',
  '## Отказы (fail-closed, error-evidence записан)',
  '',
  ...(failures.length > 0
    ? failures.map((entry) => `- ${entry.domain}: ${entry.status} (attempts ${entry.attempts}) — ${entry.error}`)
    : ['- нет']),
  '',
  '## Пропущены политикой (fortress-класс, не сканировались)',
  '',
  ...skippedByPolicy.map((entry) => `- ${entry.domain}: ${entry.reason}`),
  '',
]
writeFileSync(join(dirname(outPath), 'summary.md'), md.join('\n'), 'utf-8')

console.log(
  `[pilot] scanned=${report.scannedCount}/${report.requestedCount} withTools=${report.domainsWithTools} (${share}%) toolEvidence=${report.toolEvidenceCount} errors=${failures.length} wall=${(wallMs / 1000).toFixed(1)}s`,
)
console.log(`[pilot] results: ${outPath}`)
console.log(`[pilot] summary: ${join(dirname(outPath), 'summary.json')}`)
