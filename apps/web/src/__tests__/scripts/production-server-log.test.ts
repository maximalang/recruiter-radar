import { spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const verifier = path.resolve(
  process.cwd(),
  '..',
  '..',
  'scripts',
  'verify-production-server-log.mjs',
)

function verifyLog(contents: string) {
  const directory = mkdtempSync(path.join(tmpdir(), 'rr-server-log-'))
  const logPath = path.join(directory, 'server.log')
  writeFileSync(logPath, contents, 'utf8')

  try {
    return spawnSync(process.execPath, [verifier, logPath], {
      encoding: 'utf8',
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('production server log verifier', () => {
  it('accepts normal Next.js startup and expected application notices', () => {
    const result = verifyLog([
      '▲ Next.js 16.2.11',
      '✓ Ready in 120ms',
      'Public preview has no eligible items; serving interactive sample fallback',
    ].join('\n'))

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Production server log is clean')
  })

  it.each([
    'LANDING_ANALYTICS_RATE_LIMIT_SALT is required',
    'Unhandled promise rejection',
    'uncaughtException: route crashed',
    'unhandledRejection: database failed',
    '⨯ Error: rendering failed',
    '⨯ [Error: rendering failed]',
    'TypeError: cannot read properties of undefined',
    'ReferenceError: missingValue is not defined',
  ])('fails and prints a critical application error: %s', (criticalLine) => {
    const result = verifyLog(`✓ Ready in 120ms\n${criticalLine}\n`)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(criticalLine)
  })
})
