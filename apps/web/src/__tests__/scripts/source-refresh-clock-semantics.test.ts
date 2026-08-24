import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const workflowPath = join(process.cwd(), '../../.github/workflows/source-refresh-clock.yml')
const workflowRaw = readFileSync(workflowPath, 'utf8')
// Tolerate CRLF: the file is checked out with Windows line endings locally.
const workflow = workflowRaw.replaceAll('\r\n', '\n')

// Extract the embedded NODE script (between the heredoc markers) so the exact
// production logic is exercised, not a re-implementation.
const nodeStart = workflow.indexOf("<<'NODE'\n") + "<<'NODE'\n".length
const nodeEnd = workflow.indexOf('\n          NODE\n', nodeStart)
if (nodeStart < 10 || nodeEnd < 0) throw new Error('cannot extract NODE script from workflow')

type Wire = { status: number; rawBody: string }
type RunEnv = { SOURCE_REFRESH_MAX_FAILED_SOURCES?: string }
type ExecFailure = {
  message?: unknown
  status?: number
  stdout?: string
  stderr?: string
}

// The workflow passes the budget into the remote container via an Actions
// expression ('${{ env.SOURCE_REFRESH_MAX_FAILED_SOURCES }}'), not via
// process.env — runner env does not survive SSH + docker compose exec. For the
// contract run we substitute a concrete integer literal the same way Actions
// would, then optionally override it through the same channel.
function normalizedBody(budgetOverride?: string) {
  let body = workflow.slice(nodeStart, nodeEnd)
  const expression = "${{ env.SOURCE_REFRESH_MAX_FAILED_SOURCES }}"
  if (!body.includes(expression)) {
    throw new Error('workflow does not pass SOURCE_REFRESH_MAX_FAILED_SOURCES into the remote NODE script')
  }
  // Emulate GitHub Actions parse-time substitution: without an explicit
  // override the pinned workflow-level env value is used, exactly as the
  // runner would substitute it before shipping the script over SSH.
  const budget = budgetOverride !== undefined
    ? budgetOverride
    : (workflow.match(/SOURCE_REFRESH_MAX_FAILED_SOURCES:\s*'(\d+)'/) ?? [])[1]
  if (budget === undefined) {
    throw new Error('workflow does not pin SOURCE_REFRESH_MAX_FAILED_SOURCES at env level')
  }
  return body.replaceAll(expression, budget)
}

function runScript(wire: Wire, env: RunEnv = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'src-refresh-clock-'))
  const scriptPath = join(directory, 'clock.mjs')
  const budget = env.SOURCE_REFRESH_MAX_FAILED_SOURCES
  writeFileSync(scriptPath, buildNodeScriptWithBudget(wire, budget), 'utf8')
  try {
    const stdout = execFileSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      env: { ...process.env, CRON_API_KEY: 'test-key' }, // budget deliberately NOT in env
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, stdout }
  } catch (error) {
    const failure = error as ExecFailure
    // The stubbed process.exit throws '__EXIT__<code>'; map it back so
    // explicit process.exit(0) is distinguishable from a real crash.
    const message = String(failure.message ?? '')
    const exitMatch = message.match(/__EXIT__(\d+)/)
    if (exitMatch) {
      const code = Number(exitMatch[1])
      if (code === 0) return { code: 0, stdout: failure.stdout ?? '' }
      return { code, stdout: failure.stdout ?? '', stderr: String(failure.stderr ?? message) }
    }
    return { code: failure.status ?? 1, stdout: failure.stdout ?? '', stderr: String(failure.stderr ?? failure.message) }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function buildNodeScriptWithBudget(wire: Wire, budget?: string) {
  const preamble = `
    const http = {
      request: (_options, onResponse) => {
        const wire = ${JSON.stringify(wire)}
        const incoming = {
          statusCode: wire.status,
          setEncoding: () => {},
          on: (event, handler) => {
            if (event === 'data') setImmediate(() => handler(wire.rawBody))
            if (event === 'end') setImmediate(handler)
            if (event === 'error') {}
          },
        }
        const request = {
          setTimeout: () => {},
          destroy: () => {},
          on: () => {},
          end: () => { setImmediate(() => onResponse(incoming)) },
        }
        return request
      },
    }
    process.exit = (code) => { throw Object.assign(new Error('__EXIT__' + code), { exitCode: code }) }
  `
  const lines = normalizedBody(budget).split('\n').map((line) => line.replace(/^ {10}/, ''))
  if (!lines[0]?.startsWith("const http = await import('node:http')")) {
    throw new Error(`unexpected NODE script head: ${JSON.stringify(lines[0])}`)
  }
  lines[0] = ''
  return preamble + lines.join('\n')
}

function lastJsonLine(stdout: string): unknown {
  const lines = stdout.trim().split('\n')
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try { return JSON.parse(lines[i]) } catch { /* skip non-JSON lines */ }
  }
  return null
}

const okDetails = [
  { source: 'hh', success: true, outcome: 'ingested', criticality: 'required' },
]
// career-pages is digest-lead-originating => required; funding-business-signals
// is context-only => optional; an unregistered id maps to unknown (fail-closed).
const partialOptionalDetails = [
  { source: 'hh', success: true, outcome: 'ingested', criticality: 'required' },
  { source: 'funding-business-signals', success: false, outcome: 'failed', criticality: 'optional' },
]
const partialRequiredDetails = [
  { source: 'hh', success: true, outcome: 'ingested', criticality: 'required' },
  { source: 'career-pages', success: false, outcome: 'failed', criticality: 'required' },
  { source: 'funding-business-signals', success: false, outcome: 'failed', criticality: 'optional' },
]
const partialUnknownDetails = [
  { source: 'hh', success: true, outcome: 'ingested', criticality: 'required' },
  { source: 'mystery-source', success: false, outcome: 'failed', criticality: 'unknown' },
]

describe('source-refresh-clock workflow semantics', () => {
  test('budget is passed into the remote command via an Actions expression, not runner env', () => {
    // The embedded NODE script must read the budget from an '${{ ... }}'
    // expression substituted at parse time; relying on process.env would break
    // across SSH + docker compose exec where runner env is absent.
    expect(workflow).toMatch(/\$\{\{ env\.SOURCE_REFRESH_MAX_FAILED_SOURCES \}\}/)
    expect(workflow).not.toContain("process.env.SOURCE_REFRESH_MAX_FAILED_SOURCES")
    // The value itself stays pinned at workflow level (integer-only).
    expect(workflow.match(/SOURCE_REFRESH_MAX_FAILED_SOURCES:\s*'(\d+)'/)?.[1]).toBeDefined()
  })

  test('non-integer budget substitution fails closed before any HTTP work', () => {
    const result = runScript(
      { status: 200, rawBody: JSON.stringify({ success: true, data: { total: 1, succeeded: 1, failed: 0, deferred: 0, details: okDetails } }) },
      { SOURCE_REFRESH_MAX_FAILED_SOURCES: '2;rm' },
    )
    expect(result.code).not.toBe(0)
    expect(result.stdout + result.stderr).toContain('must be a non-negative integer literal')
  })

  test('HTTP 200 with valid payload exits 0 without warnings', () => {
    const result = runScript({ status: 200, rawBody: JSON.stringify({ success: true, data: { total: 1, succeeded: 1, failed: 0, deferred: 0, credentialGated: 0, rateLimited: 0, failedRequired: 0, failedOptional: 0, deliveryImpactingFailure: false, details: okDetails } }) })
    expect(result.code).toBe(0)
    const summary = lastJsonLine(result.stdout)
    expect(summary).toMatchObject({ status: 200, total: 1, succeeded: 1, failed: 0 })
    expect(result.stdout).not.toContain('::warning::')
  })

  test('HTTP 207 optional-only failures within budget: warning + summary, exits 0', () => {
    const result = runScript(
      {
        status: 207,
        rawBody: JSON.stringify({
          success: false,
          data: {
            total: 2, succeeded: 1, failed: 1, deferred: 0, credentialGated: 0, rateLimited: 0,
            failedRequired: 0, failedOptional: 1, deliveryImpactingFailure: false,
            details: partialOptionalDetails,
          },
        }),
      },
      { SOURCE_REFRESH_MAX_FAILED_SOURCES: '1' },
    )
    expect(result.code).toBe(0)
    const summary = lastJsonLine(result.stdout)
    expect(summary).toMatchObject({
      status: 207,
      total: 2,
      succeeded: 1,
      failed: 1,
      failedRequired: 0,
      failedOptional: 1,
      deliveryImpactingFailure: false,
      failedSources: [{ source: 'funding-business-signals', outcome: 'failed', criticality: 'optional' }],
    })
    expect(result.stdout).toContain('::warning::')
    expect(result.stdout).not.toContain('::error::')
  })

  test('route-to-workflow: rate-limited OPTIONAL source (success:true upstream) arrives as budgeted partial — warning, exit 0', () => {
    // This is the exact payload the route now produces for CASE J:
    // an optional source throttled with success:true becomes an effective
    // failure with criticality 'optional' and lands in a 207 partial.
    const result = runScript(
      {
        status: 207,
        rawBody: JSON.stringify({
          success: false,
          data: {
            total: 2, succeeded: 1, failed: 1, deferred: 0, credentialGated: 0, rateLimited: 1,
            failedRequired: 0, failedOptional: 1, deliveryImpactingFailure: false,
            details: [
              { source: 'hh', success: true, outcome: 'ingested', criticality: 'required' },
              { source: 'funding-business-signals', success: true, outcome: 'rate-limited', criticality: 'optional' },
            ],
          },
        }),
      },
      { SOURCE_REFRESH_MAX_FAILED_SOURCES: '1' },
    )
    expect(result.code).toBe(0)
    const summary = lastJsonLine(result.stdout)
    expect(summary).toMatchObject({
      status: 207,
      failedRequired: 0,
      failedOptional: 1,
      deliveryImpactingFailure: false,
      failedSources: [{ source: 'funding-business-signals', outcome: 'rate-limited', criticality: 'optional' }],
    })
    expect(result.stdout).toContain('::warning::')
    expect(result.stdout).not.toContain('::error::')
  })

  test('route-to-workflow: rate-limited REQUIRED source (success:true upstream) arrives as delivery-impacting — ::error::, exit 1', () => {
    // This is the exact payload the route now produces for CASE H: a required
    // source throttled with success:true must never surface as a green run.
    const result = runScript(
      {
        status: 207,
        rawBody: JSON.stringify({
          success: false,
          data: {
            total: 1, succeeded: 0, failed: 1, deferred: 0, credentialGated: 0, rateLimited: 1,
            failedRequired: 1, failedOptional: 0, deliveryImpactingFailure: true,
            details: [
              { source: 'hh', success: true, outcome: 'rate-limited', criticality: 'required' },
            ],
          },
        }),
      },
      { SOURCE_REFRESH_MAX_FAILED_SOURCES: '5' },
    )
    expect(result.code).not.toBe(0)
    expect(result.stdout + result.stderr).toContain('delivery-impacting failures')
    expect(result.stdout + result.stderr).toContain('hh')
  })

  test('HTTP 207 with a required-source failure fails the step regardless of budget', () => {
    const result = runScript(
      {
        status: 207,
        rawBody: JSON.stringify({
          success: false,
          data: {
            total: 3, succeeded: 1, failed: 2, deferred: 0, credentialGated: 0, rateLimited: 0,
            failedRequired: 1, failedOptional: 1, deliveryImpactingFailure: true,
            details: partialRequiredDetails,
          },
        }),
      },
      { SOURCE_REFRESH_MAX_FAILED_SOURCES: '5' },
    )
    expect(result.code).not.toBe(0)
    expect(result.stdout + result.stderr).toContain('delivery-impacting failures')
    expect(result.stdout + result.stderr).toContain('career-pages')
    // Full summary with per-source criticality stays observable.
    expect(lastJsonLine(result.stdout)).toMatchObject({
      status: 207,
      failedRequired: 1,
      deliveryImpactingFailure: true,
    })
  })

  test('HTTP 207 with an unknown-criticality failure fails closed (fail-closed on ambiguity)', () => {
    const result = runScript(
      {
        status: 207,
        rawBody: JSON.stringify({
          success: false,
          data: {
            total: 2, succeeded: 1, failed: 1, deferred: 0, credentialGated: 0, rateLimited: 0,
            failedRequired: 1, failedOptional: 0, deliveryImpactingFailure: true,
            details: partialUnknownDetails,
          },
        }),
      },
      { SOURCE_REFRESH_MAX_FAILED_SOURCES: '5' },
    )
    expect(result.code).not.toBe(0)
    expect(result.stdout + result.stderr).toMatch(/mystery-source/)
  })

  test('legacy payload without criticality fields fails closed (schema drift guard)', () => {
    // An older build without the criticality contract must not be treated as
    // "all clear": absent deliveryImpactingFailure is not `false`.
    const result = runScript(
      {
        status: 207,
        rawBody: JSON.stringify({
          success: false,
          data: { total: 2, succeeded: 1, failed: 1, deferred: 0, details: [{ source: 'hh', success: false, outcome: 'failed' }] },
        }),
      },
      { SOURCE_REFRESH_MAX_FAILED_SOURCES: '5' },
    )
    expect(result.code).not.toBe(0)
    expect(result.stdout + result.stderr).toContain('invalid or unparseable payload')
  })

  test('HTTP 422 (no active profiles) exits 0 as an expected no-op', () => {
    const result = runScript({ status: 422, rawBody: JSON.stringify({ success: false, error: 'No active client profiles; source refresh skipped.', hint: 'x' }) })
    expect(result.code).toBe(0)
  })

  test('HTTP 422 with a non-contract payload fails closed', () => {
    const result = runScript({ status: 422, rawBody: JSON.stringify({ success: false, error: 'Upstream validation failed', hint: 'x' }) })
    expect(result.code).not.toBe(0)
    expect(result.stdout + result.stderr).toContain('invalid or unparseable payload')
  })

  test('HTTP 422 with a malformed (non-JSON) body fails closed', () => {
    const result = runScript({ status: 422, rawBody: '<html>gateway 422</html>' })
    expect(result.code).not.toBe(0)
    expect(result.stdout + result.stderr).toContain('invalid or unparseable payload')
  })

  test('HTTP 422 with an unexpected extra top-level key fails closed', () => {
    // Strict shape guard: the canonical no-op has exactly error,hint,success.
    const result = runScript({
      status: 422,
      rawBody: JSON.stringify({
        success: false,
        error: 'No active client profiles; source refresh skipped.',
        hint: 'x',
        extra: true,
      }),
    })
    expect(result.code).not.toBe(0)
    expect(result.stdout + result.stderr).toContain('invalid or unparseable payload')
  })

  test('HTTP 207 without the failed counter fails closed even when details show an optional failure', () => {
    const result = runScript({
      status: 207,
      rawBody: JSON.stringify({
        success: false,
        data: {
          total: 2,
          succeeded: 1,
          // `failed` intentionally omitted: details still contain one failure.
          deferred: 0,
          credentialGated: 0,
          rateLimited: 0,
          failedRequired: 0,
          failedOptional: 1,
          deliveryImpactingFailure: false,
          details: partialOptionalDetails,
        },
      }),
    })
    expect(result.code).not.toBe(0)
    expect(result.stdout + result.stderr).toContain('invalid or unparseable payload')
  })

  test('malformed JSON payload fails closed even on HTTP 200', () => {
    const result = runScript({ status: 200, rawBody: '<html>gateway garbage</html>' })
    expect(result.code).not.toBe(0)
    expect(result.stdout + result.stderr).toContain('invalid or unparseable payload')
  })

  test('valid JSON without data.details fails closed (schema drift guard)', () => {
    const result = runScript({ status: 200, rawBody: JSON.stringify({ success: true, unexpected: true }) })
    expect(result.code).not.toBe(0)
    expect(result.stdout + result.stderr).toContain('invalid or unparseable payload')
  })
})
