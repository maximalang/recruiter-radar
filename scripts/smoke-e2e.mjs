#!/usr/bin/env node

/**
 * End-to-end smoke test for Recruiter Radar.
 *
 * Runs the full pipeline: HH ingest → lead generation → scoring
 * and prints a summary. Requires real environment:
 *   - DATABASE_URL (Postgres connection)
 *   - HH_USER_AGENT (HeadHunter API identity)
 *
 * Exit code 0 if any signals were produced, 1 otherwise.
 *
 * Usage:
 *   npm run smoke:e2e
 */

import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const execFile = promisify(execFileCb)

const SCRIPT_DIR = resolve(dirname(fileURLToPath(import.meta.url)))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')
const DB_SCRIPTS = resolve(REPO_ROOT, 'packages/db/scripts')

const REQUIRED_ENV = ['DATABASE_URL', 'HH_USER_AGENT']

function checkEnv() {
  const missing = REQUIRED_ENV.filter(key => !process.env[key])
  if (missing.length > 0) {
    console.error(`❌ Missing required env vars: ${missing.join(', ')}`)
    console.error('   Set them before running smoke:e2e.')
    process.exit(1)
  }
}

async function runStep(label, scriptPath, args = []) {
  console.log(`\n▸ ${label}`)
  const { stdout, stderr } = await execFile('node', [scriptPath, ...args], {
    cwd: REPO_ROOT,
    timeout: 180_000, // 3 min
    windowsHide: true,
  })

  const output = stdout?.trim() || ''
  const errOutput = stderr?.trim() || ''

  if (errOutput && !output) {
    console.error(`  ⚠ ${errOutput.slice(0, 200)}`)
    return { ok: false, output: errOutput }
  }

  // Parse JSON metrics from last line
  let metrics = {}
  const lines = output.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line) continue
    try {
      const parsed = JSON.parse(line)
      if (parsed && typeof parsed === 'object') {
        metrics = parsed
        break
      }
    } catch {
      // not JSON, keep scanning
    }
  }

  // Print key metrics or a summary line
  const fetched = metrics.recordsReceived ?? metrics.fetchedCount
  const upserted = metrics.signalUpsertsCompleted ?? metrics.upsertedCount

  if (fetched !== undefined || upserted !== undefined) {
    console.log(`  ✓ fetched: ${fetched ?? '?'}, upserted: ${upserted ?? '?'}`)
  } else if (output.length > 0) {
    // Print last meaningful line
    const lastLine = lines.filter(l => l.trim()).slice(-1)[0]
    if (lastLine) {
      console.log(`  ✓ ${lastLine.slice(0, 200)}`)
    }
  }

  return { ok: true, output, metrics }
}

async function main() {
  console.log('═══════════════════════════════════════')
  console.log('  Recruiter Radar — E2E Smoke Test')
  console.log('═══════════════════════════════════════')

  checkEnv()

  // Step 1: HH ingestion
  const ingest = await runStep(
    'Step 1: HH ingestion',
    resolve(DB_SCRIPTS, 'ingest-hh.mjs')
  )

  // Step 2: Lead generation + scoring (via Jest smoke test)
  console.log('\n▸ Step 2: Lead generation + scoring (Jest)')
  try {
    const { stdout } = await execFile('npx', [
      'jest',
      '--testPathPattern=src/__tests__/scripts/lead-generate.smoke.test.ts',
      '--no-coverage',
      '--verbose',
    ], {
      cwd: resolve(REPO_ROOT, 'apps/web'),
      timeout: 60_000,
      windowsHide: true,
    })
    const passed = stdout.includes('passed')
    console.log(`  ✓ Scoring pipeline test: ${passed ? 'PASSED' : 'FAILED'}`)
  } catch (err) {
    console.error(`  ⚠ Scoring test failed: ${err.message?.slice(0, 200)}`)
  }

  // Step 3: Quick DB check — how many signals exist?
  console.log('\n▸ Step 3: DB signal count')
  try {
    const { execFile: pgExec } = { execFile: execFileCb }
    // Use the DB scripts infrastructure instead of direct psql
    const { stdout: metricsOut } = await execFile('node', [
      resolve(DB_SCRIPTS, 'report-hh-metrics.mjs'),
    ], {
      cwd: REPO_ROOT,
      timeout: 30_000,
      windowsHide: true,
    })
    if (metricsOut?.trim()) {
      console.log(`  ✓ ${metricsOut.trim().slice(0, 300)}`)
    }
  } catch (err) {
    console.log(`  ⚠ Metrics not available: ${err.message?.slice(0, 100)}`)
  }

  console.log('\n═══════════════════════════════════════')
  console.log('  E2E smoke test complete.')
  console.log('═══════════════════════════════════════')

  // Exit based on whether ingestion produced anything
  const fetched = ingest.metrics?.recordsReceived ?? ingest.metrics?.fetchedCount ?? 0
  if (fetched > 0) {
    console.log(`\n✅ Signals produced: ${fetched}`)
    process.exit(0)
  } else {
    console.log('\n⚠️  No signals produced. Check HH_USER_AGENT and DB connection.')
    process.exit(1)
  }
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
