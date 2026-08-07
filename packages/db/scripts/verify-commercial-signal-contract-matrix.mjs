import { resolve } from 'node:path'

import { verifyCommercialSignalContractMatrix } from './lib/commercial-signal-contract-matrix.mjs'

const root = resolve(import.meta.dirname, '..', '..', '..')
const result = await verifyCommercialSignalContractMatrix(root)
process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`)
