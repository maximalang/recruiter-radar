/**
 * Techstack enrichment (pilot) — company-level evidence signals about the web
 * technology stack of a lead's domain.
 *
 * WHAT IT IS: a thin, fail-closed adapter around the LOCAL `webstack-scanner`
 * capability (see its ACCESS.md for the canonical run command). The scanner
 * fingerprints a site's homepage over HTTP and prints one JSON object per
 * domain; this module runs it as a subprocess (timeout 40 s, one retry),
 * parses the output, and maps every detected tool into a `techstack`
 * evidence record for the lead's evidence_bundle (data model: AGENTS.md §6).
 *
 * BOUNDARIES (non-negotiable):
 * - Company-level data only — domains and site technology facts; never
 *   personal emails/phones (AGENTS.md §4).
 * - Fail-closed: a scanner-reported `fetch_error` becomes error-evidence; a
 *   crashed/timed-out/unparsable scanner becomes error-evidence after one
 *   retry. Nothing here throws, so a calling pipeline never fails because of
 *   enrichment.
 * - Politeness guards: strictly sequential scans, ≥1 s between domains,
 *   ≤200 domains per run (hard cap), and a global feature flag that is OFF by
 *   default — no scan happens unless enrichment is explicitly enabled.
 * - Pilot scope: this module produces evidence records and a batch report.
 *   Persistence into lead storage is a separate reviewed step, NOT part of
 *   the pilot.
 *
 * ENVIRONMENT:
 * - TECHSTACK_ENRICHMENT_ENABLED=true — feature flag; any other value = off.
 * - TECHSTACK_SCANNER_PYTHON — interpreter for the scanner (default: the
 *   canonical curl-cffi venv python from the capability's ACCESS.md).
 * - TECHSTACK_SCANNER_SCRIPT — path to scan.py (default: canonical location).
 * - Guard knobs (TECHSTACK_TIMEOUT_MS, TECHSTACK_MAX_RETRIES,
 *   TECHSTACK_MIN_DELAY_MS, TECHSTACK_MAX_DOMAINS) may only TIGHTEN the
 *   spec-fixed bounds, never relax them (delay floor 1 s, cap 200, retries ≤1).
 *
 * RUNTIME: Node.js only (child_process via the bundler-opaque `node-exec`
 * seam — same pattern as `lead-discovery/source-ingest.ts`). Unit tests mock
 * `@/lib/lead-discovery/node-exec` and replay recorded JSON fixtures — no
 * live HTTP in tests.
 */

import { getExecFile } from '../lead-discovery/node-exec'

/** Evidence source tag for every record this module produces. */
export const TECHSTACK_EVIDENCE_SOURCE = 'techstack' as const

/** Canonical capability locations (webstack-scanner ACCESS.md, 27.09.2026). */
export const TECHSTACK_SCANNER_DEFAULTS = {
  pythonPath:
    'C:/Users/max/Desktop/all/tools/capabilities/curl-cffi/venv/Scripts/python.exe',
  scannerScript:
    'C:/Users/max/Desktop/all/tools/capabilities/webstack-scanner/scan.py',
} as const

/** Spec-fixed guard values (SPEC-enrichment-pilot.md): 40 s, 1 retry, ≥1 s, ≤200. */
export const TECHSTACK_TIMEOUT_MS = 40_000
export const TECHSTACK_MAX_RETRIES = 1
export const TECHSTACK_MIN_DELAY_MS = 1_000
export const TECHSTACK_MAX_DOMAINS_PER_RUN = 200

/** One detected tool, exactly as the scanner reports it. */
export interface TechstackToolSignal {
  name: string
  confidence: number
  version: string | null
  sources: string[]
  categories: string[]
}

/** The scanner's single-domain JSON output (contract fields this module uses). */
export interface TechstackScanRaw {
  domain: string
  url: string | null
  http_status: number | null
  scanned_at: string | null
  elapsed_ms: number | null
  tool_count: number | null
  tools: TechstackToolSignal[]
  fetch_error: string | null
}

/** Evidence for one detected tool — the spec's signal contract. */
export interface TechstackToolEvidence {
  source: typeof TECHSTACK_EVIDENCE_SOURCE
  tool: string
  categories: string[]
  confidence: number
  version: string | null
  scanned_at: string
  domain: string
}

/** Error-evidence — the scan produced no usable tool signal. */
export interface TechstackErrorEvidence {
  source: typeof TECHSTACK_EVIDENCE_SOURCE
  tool: null
  categories: string[]
  confidence: 0
  version: null
  scanned_at: string
  domain: string
  error: string
  error_kind: TechstackScanStatus
}

export type TechstackEvidence = TechstackToolEvidence | TechstackErrorEvidence

export type TechstackScanStatus =
  | 'ok'
  | 'fetch_error'
  | 'scanner_error'
  | 'invalid_output'
  | 'invalid_domain'

export interface TechstackConfig {
  /** Global kill-switch; default false — enrichment never runs implicitly. */
  enabled: boolean
  pythonPath: string
  scannerScript: string
  timeoutMs: number
  maxRetries: number
  minDelayMs: number
  maxDomainsPerRun: number
}

export type TechstackEnv = Record<string, string | undefined>

export interface TechstackScanDeps {
  /** Injectable clock (deterministic tests). */
  now?: () => Date
  /** Injectable inter-domain pause (tests assert the guard, not real time). */
  sleep?: (ms: number) => Promise<void>
}

export interface TechstackScanOutcome {
  domain: string
  status: TechstackScanStatus
  /** Parsed scanner JSON when the process produced usable output. */
  raw: TechstackScanRaw | null
  /** Failure reason (null on success). */
  error: string | null
  /** Subprocess attempts (1 = first try settled it; 0 = never spawned). */
  attempts: number
  elapsedMs: number
  startedAt: string
}

export type TechstackSkipReason =
  | 'invalid_domain'
  | 'duplicate'
  | 'over_limit'
  | 'disabled'

export interface TechstackDomainEnrichment {
  domain: string
  outcome: TechstackScanOutcome
  evidence: TechstackEvidence[]
}

export interface TechstackBatchReport {
  enabled: boolean
  requestedCount: number
  scannedCount: number
  domainsWithTools: number
  toolEvidenceCount: number
  errorEvidenceCount: number
  results: TechstackDomainEnrichment[]
  skipped: { input: string; reason: TechstackSkipReason }[]
  truncated: boolean
  startedAt: string
  finishedAt: string
  totalElapsedMs: number
}

function readNonEmpty(env: TechstackEnv, name: string): string | null {
  const raw = env[name]
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Parse a positive int from env and clamp it into [min, max]. */
function readClampedInt(
  env: TechstackEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = readNonEmpty(env, name)
  if (raw === null || !/^\d+$/.test(raw)) return fallback
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/**
 * Effective enrichment config. The feature flag defaults to OFF; guard values
 * can be tightened via env but never relaxed past the spec bounds.
 */
export function loadTechstackConfig(env: TechstackEnv = process.env): TechstackConfig {
  return {
    enabled: readNonEmpty(env, 'TECHSTACK_ENRICHMENT_ENABLED')?.toLowerCase() === 'true',
    pythonPath: readNonEmpty(env, 'TECHSTACK_SCANNER_PYTHON') ?? TECHSTACK_SCANNER_DEFAULTS.pythonPath,
    scannerScript: readNonEmpty(env, 'TECHSTACK_SCANNER_SCRIPT') ?? TECHSTACK_SCANNER_DEFAULTS.scannerScript,
    timeoutMs: readClampedInt(env, 'TECHSTACK_TIMEOUT_MS', TECHSTACK_TIMEOUT_MS, 1_000, 120_000),
    maxRetries: readClampedInt(env, 'TECHSTACK_MAX_RETRIES', TECHSTACK_MAX_RETRIES, 0, TECHSTACK_MAX_RETRIES),
    minDelayMs: readClampedInt(env, 'TECHSTACK_MIN_DELAY_MS', TECHSTACK_MIN_DELAY_MS, TECHSTACK_MIN_DELAY_MS, 60_000),
    maxDomainsPerRun: readClampedInt(env, 'TECHSTACK_MAX_DOMAINS', TECHSTACK_MAX_DOMAINS_PER_RUN, 1, TECHSTACK_MAX_DOMAINS_PER_RUN),
  }
}

const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

/**
 * Validate and normalise a company domain for scanning. Accepts bare
 * hostnames and http(s) URLs (leads may carry website URLs); strips
 * scheme/path/query and rejects anything that is not a plain hostname.
 * Returns the lowercased hostname, or null when unusable.
 */
export function normalizeTechstackDomain(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let value = raw.trim().toLowerCase()
  if (value.length === 0 || value.length > 253) return null
  const withScheme = /^(?:https?:\/\/)(.+)$/.exec(value)
  if (withScheme) value = withScheme[1]
  const cut = value.search(/[/?#]/)
  if (cut >= 0) value = value.slice(0, cut)
  if (value.length === 0) return null
  if (value.includes('@') || value.includes(':')) return null
  if (value.startsWith('.') || value.endsWith('.')) return null
  return DOMAIN_PATTERN.test(value) ? value : null
}

/** Env keys the scanner child process may inherit — nothing else. */
const SCANNER_ENV_PASSTHROUGH = [
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'HOME',
  'LANG',
  'LC_ALL',
] as const

/**
 * Minimal env for the scanner subprocess: PATH/TEMP (+ SystemRoot for Windows
 * TLS), UTF-8 python IO, and the NODE_ENV literal required by the Next.js
 * ProcessEnv contract (next/types/global.d.ts) — meaningless for the python
 * child but part of the type. App secrets (DATABASE_URL, tokens, webhook
 * keys) are deliberately NOT inherited by the child process.
 */
export function buildScannerEnv(source: TechstackEnv = process.env): NodeJS.ProcessEnv {
  const nodeEnvRaw = readNonEmpty(source, 'NODE_ENV')
  const nodeEnv: 'development' | 'production' | 'test' =
    nodeEnvRaw === 'development' || nodeEnvRaw === 'production' || nodeEnvRaw === 'test'
      ? nodeEnvRaw
      : 'production'
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: nodeEnv,
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
  }
  for (const name of SCANNER_ENV_PASSTHROUGH) {
    const value = source[name]
    if (typeof value === 'string' && value.length > 0) env[name] = value
  }
  return env
}

/**
 * Parse and shape-validate the scanner's single-domain JSON. Returns null for
 * unusable output (not JSON, wrong shape, or neither tools nor fetch_error).
 * Defensive by design: unknown extra fields are dropped, malformed tool
 * entries are normalised or discarded.
 */
export function parseScannerOutput(stdout: string): TechstackScanRaw | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const candidate = parsed as Record<string, unknown>
  if (typeof candidate.domain !== 'string' || candidate.domain.length === 0) return null
  const rawTools = Array.isArray(candidate.tools) ? candidate.tools : null
  const fetchError =
    typeof candidate.fetch_error === 'string' && candidate.fetch_error.length > 0
      ? candidate.fetch_error
      : null
  if (rawTools === null && fetchError === null) return null

  const tools: TechstackToolSignal[] = (rawTools ?? [])
    .filter((tool): tool is Record<string, unknown> => typeof tool === 'object' && tool !== null)
    .map((tool) => ({
      name: typeof tool.name === 'string' ? tool.name.trim() : '',
      confidence:
        typeof tool.confidence === 'number' && Number.isFinite(tool.confidence)
          ? tool.confidence
          : 0,
      version: typeof tool.version === 'string' && tool.version.length > 0 ? tool.version : null,
      sources: Array.isArray(tool.sources)
        ? tool.sources.filter((entry): entry is string => typeof entry === 'string')
        : [],
      categories: Array.isArray(tool.categories)
        ? tool.categories.filter((entry): entry is string => typeof entry === 'string')
        : [],
    }))
    .filter((tool) => tool.name.length > 0)

  return {
    domain: candidate.domain,
    url: typeof candidate.url === 'string' ? candidate.url : null,
    http_status: typeof candidate.http_status === 'number' ? candidate.http_status : null,
    scanned_at: typeof candidate.scanned_at === 'string' ? candidate.scanned_at : null,
    elapsed_ms: typeof candidate.elapsed_ms === 'number' ? candidate.elapsed_ms : null,
    tool_count: typeof candidate.tool_count === 'number' ? candidate.tool_count : tools.length,
    tools,
    fetch_error: fetchError,
  }
}

function describeProcessFailure(error: unknown, stderr: string, timeoutMs: number): string {
  const failure = error as
    | { killed?: boolean; code?: number | string; message?: string }
    | null
  const suffix = stderr.trim().length > 0 ? ` stderr=${stderr.trim().slice(0, 200)}` : ''
  if (failure && failure.killed === true) {
    return `scanner timed out after ${timeoutMs}ms${suffix}`
  }
  if (failure && typeof failure.code === 'number') {
    return `scanner exited with code ${failure.code}${suffix}`
  }
  const message =
    failure && typeof failure.message === 'string' && failure.message.length > 0
      ? failure.message
      : 'unknown scanner failure'
  return `${message}${suffix}`
}

function runScannerProcess(config: TechstackConfig, domain: string): Promise<{ stdout: string }> {
  const execFile = getExecFile()
  return new Promise((resolve, reject) => {
    execFile(
      config.pythonPath,
      [config.scannerScript, '--domain', domain],
      {
        timeout: config.timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
        env: buildScannerEnv(),
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              describeProcessFailure(error, typeof stderr === 'string' ? stderr : '', config.timeoutMs),
            ),
          )
          return
        }
        resolve({ stdout: typeof stdout === 'string' ? stdout : String(stdout ?? '') })
      },
    )
  })
}

/**
 * Scan one domain with the local webstack-scanner. NEVER throws — every
 * failure mode is a structured outcome (fail-closed).
 *
 * Retry policy: one retry for subprocess failures (crash, timeout, non-zero
 * exit) and unparsable output. A scanner-reported `fetch_error` is a VALID
 * scan result (the target site refused or failed the fetch) and is not
 * retried — retrying would double the load on a hostile/fortress site.
 */
export async function scanDomainTechstack(
  rawDomain: string,
  config: TechstackConfig = loadTechstackConfig(),
  deps: TechstackScanDeps = {},
): Promise<TechstackScanOutcome> {
  const now = deps.now ?? (() => new Date())
  const started = now()
  const startedAt = started.toISOString()
  const domain = normalizeTechstackDomain(rawDomain)
  if (domain === null) {
    return {
      domain: typeof rawDomain === 'string' ? rawDomain.trim().slice(0, 253) : '',
      status: 'invalid_domain',
      raw: null,
      error: 'input is not a scannable domain',
      attempts: 0,
      elapsedMs: 0,
      startedAt,
    }
  }

  const maxAttempts = config.maxRetries + 1
  let lastStatus: TechstackScanStatus = 'scanner_error'
  let lastError = 'scanner produced no usable output'

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { stdout } = await runScannerProcess(config, domain)
      const raw = parseScannerOutput(stdout)
      if (raw === null) {
        lastStatus = 'invalid_output'
        lastError = `unparsable scanner output (${stdout.trim().slice(0, 120) || 'empty stdout'})`
        continue
      }
      const elapsedMs = now().getTime() - started.getTime()
      if (raw.fetch_error !== null) {
        return {
          domain,
          status: 'fetch_error',
          raw,
          error: raw.fetch_error,
          attempts: attempt,
          elapsedMs,
          startedAt,
        }
      }
      return { domain, status: 'ok', raw, error: null, attempts: attempt, elapsedMs, startedAt }
    } catch (error) {
      lastStatus = 'scanner_error'
      lastError = error instanceof Error ? error.message : 'unknown scanner failure'
    }
  }

  return {
    domain,
    status: lastStatus,
    raw: null,
    error: lastError,
    attempts: maxAttempts,
    elapsedMs: now().getTime() - started.getTime(),
    startedAt,
  }
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

/**
 * Map a scan outcome to evidence_bundle records (spec contract):
 * - `ok` → one record per detected tool;
 * - any failure → exactly one error-evidence record (fail-closed).
 *
 * Records carry company-level facts only (domain + technology), never
 * personal contacts. `confidence` keeps the scanner's 0–100 scale
 * (wappalyzer convention), clamped to [0, 100].
 */
export function toTechstackEvidence(outcome: TechstackScanOutcome): TechstackEvidence[] {
  const scannedAt = outcome.raw?.scanned_at || outcome.startedAt
  if (outcome.status === 'ok' && outcome.raw !== null) {
    return outcome.raw.tools.map((tool) => ({
      source: TECHSTACK_EVIDENCE_SOURCE,
      tool: tool.name,
      categories: [...tool.categories],
      confidence: clampConfidence(tool.confidence),
      version: tool.version,
      scanned_at: scannedAt,
      domain: outcome.domain,
    }))
  }
  return [
    {
      source: TECHSTACK_EVIDENCE_SOURCE,
      tool: null,
      categories: [],
      confidence: 0,
      version: null,
      scanned_at: scannedAt,
      domain: outcome.domain,
      error: outcome.error ?? 'unknown scan failure',
      error_kind: outcome.status === 'ok' ? 'scanner_error' : outcome.status,
    },
  ]
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/**
 * Enrich a batch of lead-company domains behind all guards:
 * feature flag (off → zero scans), normalisation + dedupe, the per-run domain
 * cap, and a ≥minDelayMs pause between consecutive scans. Sequential by
 * design — politeness toward target sites is a hard requirement.
 *
 * Never throws: per-domain failures land in the report as error-evidence.
 */
export async function enrichDomainsWithTechstack(
  rawDomains: readonly string[],
  config: TechstackConfig = loadTechstackConfig(),
  deps: TechstackScanDeps = {},
): Promise<TechstackBatchReport> {
  const now = deps.now ?? (() => new Date())
  const sleep = deps.sleep ?? defaultSleep
  const started = now()
  const skipped: { input: string; reason: TechstackSkipReason }[] = []
  const queue: string[] = []
  const seen = new Set<string>()

  for (const raw of rawDomains) {
    const domain = normalizeTechstackDomain(raw)
    if (domain === null) {
      skipped.push({ input: typeof raw === 'string' ? raw.slice(0, 253) : String(raw ?? ''), reason: 'invalid_domain' })
      continue
    }
    if (seen.has(domain)) {
      skipped.push({ input: domain, reason: 'duplicate' })
      continue
    }
    seen.add(domain)
    queue.push(domain)
  }

  const accepted = queue.slice(0, config.maxDomainsPerRun)
  const truncated = queue.length > accepted.length
  for (const domain of queue.slice(accepted.length)) {
    skipped.push({ input: domain, reason: 'over_limit' })
  }

  const finish = (results: TechstackDomainEnrichment[]): TechstackBatchReport => {
    const finished = now()
    let toolEvidenceCount = 0
    let errorEvidenceCount = 0
    let domainsWithTools = 0
    for (const result of results) {
      const tools = result.evidence.filter((item) => item.tool !== null).length
      toolEvidenceCount += tools
      errorEvidenceCount += result.evidence.length - tools
      if (tools > 0) domainsWithTools += 1
    }
    return {
      enabled: config.enabled,
      requestedCount: rawDomains.length,
      scannedCount: results.length,
      domainsWithTools,
      toolEvidenceCount,
      errorEvidenceCount,
      results,
      skipped,
      truncated,
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      totalElapsedMs: finished.getTime() - started.getTime(),
    }
  }

  if (!config.enabled) {
    // Kill-switch: flag off → no subprocess is ever spawned.
    for (const domain of accepted) skipped.push({ input: domain, reason: 'disabled' })
    return finish([])
  }

  const results: TechstackDomainEnrichment[] = []
  for (let index = 0; index < accepted.length; index += 1) {
    const outcome = await scanDomainTechstack(accepted[index], config, deps)
    results.push({ domain: outcome.domain, outcome, evidence: toTechstackEvidence(outcome) })
    if (index < accepted.length - 1) await sleep(config.minDelayMs)
  }
  return finish(results)
}
