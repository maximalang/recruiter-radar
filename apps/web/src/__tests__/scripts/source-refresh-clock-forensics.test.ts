import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const workflowPath = join(process.cwd(), '../../.github/workflows/source-refresh-clock.yml')
const workflow = readFileSync(workflowPath, 'utf8').replaceAll('\r\n', '\n')
const nodeStart = workflow.indexOf("<<'NODE'\n") + "<<'NODE'\n".length
const nodeEnd = workflow.indexOf('\n          NODE\n', nodeStart)
if (nodeStart < 10 || nodeEnd < 0) throw new Error('cannot extract NODE script from workflow')

function runClock(body: unknown): string {
  const directory = mkdtempSync(join(tmpdir(), 'src-refresh-clock-forensics-'))
  const scriptPath = join(directory, 'clock.mjs')
  const preamble = `
    const http = {
      request: (_options, onResponse) => {
        const wire = ${JSON.stringify({ status: 207, body })}
        const response = {
          statusCode: wire.status,
          setEncoding: () => {},
          on: (event, handler) => {
            if (event === 'data') setImmediate(() => handler(JSON.stringify(wire.body)))
            if (event === 'end') setImmediate(handler)
          },
        }
        return {
          setTimeout: () => {}, destroy: () => {}, on: () => {},
          end: () => setImmediate(() => onResponse(response)),
        }
      },
    }
    process.exit = (code) => { throw Object.assign(new Error('__EXIT__' + code), { exitCode: code }) }
  `
  const script = workflow.slice(nodeStart, nodeEnd)
    .replace("const http = await import('node:http')", '')
    .replaceAll("${{ env.SOURCE_REFRESH_MAX_FAILED_SOURCES }}", '1')
    .split('\n')
    .map((line) => line.replace(/^ {10}/, ''))
    .join('\n')
  writeFileSync(scriptPath, preamble + script, 'utf8')
  try {
    return execFileSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      env: { ...process.env, CRON_API_KEY: 'test-key' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    return String((error as { stdout?: string }).stdout ?? '')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function lastJsonLine(stdout: string): Record<string, unknown> | null {
  for (const line of stdout.trim().split('\n').reverse()) {
    try {
      const parsed = JSON.parse(line)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch { /* Continue past Action annotations. */ }
  }
  return null
}

test('Clock emits redacted per-source failure previews without changing counters', () => {
  const secret = 'must-not-reach-clock-output'
  const bearer = 'Bearer'
  const stdout = runClock({
    success: false,
    data: {
      total: 1,
      succeeded: 0,
      failed: 1,
      deferred: 0,
      credentialGated: 0,
      rateLimited: 0,
      failedRequired: 1,
      failedOptional: 0,
      deliveryImpactingFailure: true,
      details: [{
        source: 'career-pages',
        success: false,
        outcome: 'failed',
        criticality: 'required',
        error: `upstream failed: authorization: ${bearer} ${secret}; token=${secret}`,
      }],
    },
  })

  const summary = lastJsonLine(stdout) as {
    failed?: number
    failedSources?: unknown[]
    failedSourcePreviews?: Array<{ source?: string; outcome?: string; criticality?: string; preview?: string }>
  } | null
  expect(summary).toMatchObject({
    failed: 1,
    failedSources: [{ source: 'career-pages', outcome: 'failed', criticality: 'required' }],
    failedSourcePreviews: [{ source: 'career-pages', outcome: 'failed', criticality: 'required' }],
  })
  expect(summary?.failedSourcePreviews?.[0]?.preview).toContain('[REDACTED]')
  expect(stdout).not.toContain(secret)
})
