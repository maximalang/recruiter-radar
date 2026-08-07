import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

import { verifyCommercialSignalContractMatrix } from './lib/commercial-signal-contract-matrix.mjs'

const execFileAsync = promisify(execFile)
const root = resolve(import.meta.dirname, '..', '..', '..')
const webRoot = resolve(root, 'apps', 'web')
const jestScript = resolve(root, 'node_modules', 'jest', 'bin', 'jest.js')
const result = await verifyCommercialSignalContractMatrix(root)

process.stdout.write(`${JSON.stringify({
  ok: true,
  contractCount: result.contractCount,
  postgresqlGates: result.postgresqlGates,
})}\n`)
const test = await execFileAsync(process.execPath, [
  jestScript,
  '--runInBand',
  '--runTestsByPath',
  ...result.unitFiles,
], {
  cwd: webRoot,
  env: process.env,
  maxBuffer: 20 * 1024 * 1024,
})
if (test.stdout) process.stdout.write(test.stdout)
if (test.stderr) process.stderr.write(test.stderr)
