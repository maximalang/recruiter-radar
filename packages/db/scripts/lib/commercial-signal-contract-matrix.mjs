import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

export const COMMERCIAL_SIGNAL_CONTRACT_MATRIX_SCHEMA =
  'commercial-signal-contract-matrix-v1'

const EXPECTED_IDS = Array.from(
  { length: 20 },
  (_, index) => `CSE-${String(index + 1).padStart(2, '0')}`,
)
const ALLOWED_LAYERS = new Set([
  'company_event',
  'company_state_change',
  'signal_episode',
  'commercial_thesis',
  'external_agency_propensity',
  'agency_dna_match',
  'opportunity_scoring',
  'query_planner',
])

export async function verifyCommercialSignalContractMatrix(root) {
  const webRoot = resolve(root, 'apps', 'web')
  const matrixPath = resolve(
    webRoot,
    'fixtures',
    'commercial-signal-engine-contracts.v1.json',
  )
  const packagePath = resolve(root, 'package.json')
  const workflowPath = resolve(root, '.github', 'workflows', 'test.yml')
  const [matrix, packageJson, workflow] = await Promise.all([
    readJson(matrixPath),
    readJson(packagePath),
    readFile(workflowPath, 'utf8'),
  ])
  if (matrix.schemaVersion !== COMMERCIAL_SIGNAL_CONTRACT_MATRIX_SCHEMA) {
    throw new TypeError('Unsupported Commercial Signal contract matrix schema.')
  }
  if (!String(matrix.pipelineInvariant ?? '').includes('Source Record ->')) {
    throw new TypeError('The contract matrix must declare the pipeline invariant.')
  }
  if (!Array.isArray(matrix.contracts)) {
    throw new TypeError('Contract matrix contracts must be an array.')
  }
  const ids = matrix.contracts.map((contract) => contract.id)
  if (JSON.stringify(ids) !== JSON.stringify(EXPECTED_IDS)) {
    throw new TypeError('Contract matrix must contain ordered CSE-01 through CSE-20.')
  }
  const requirements = new Set()
  const unitFiles = new Set()
  const postgresqlGates = new Set()
  const evidenceCounts = { unit: 0, postgresql: 0 }

  for (const contract of matrix.contracts) {
    const requirement = requiredText(contract.requirement, `${contract.id} requirement`)
    if (requirements.has(requirement)) {
      throw new TypeError(`Duplicate contract requirement: ${requirement}`)
    }
    requirements.add(requirement)
    if (!ALLOWED_LAYERS.has(contract.layer)) {
      throw new TypeError(`${contract.id} has an unsupported pipeline layer.`)
    }
    if (!Array.isArray(contract.evidence) || contract.evidence.length === 0) {
      throw new TypeError(`${contract.id} requires executable test evidence.`)
    }
    for (const evidence of contract.evidence) {
      const kind = evidence.kind
      if (!['unit', 'postgresql'].includes(kind)) {
        throw new TypeError(`${contract.id} has an unsupported evidence kind.`)
      }
      const relativeFile = safeTestPath(evidence.file, contract.id)
      const absoluteFile = resolve(webRoot, relativeFile)
      if (!absoluteFile.startsWith(`${webRoot}${sep}`)) {
        throw new TypeError(`${contract.id} test path escapes the web workspace.`)
      }
      const source = await readFile(absoluteFile, 'utf8')
      const testName = requiredText(evidence.testName, `${contract.id} testName`)
      if (!source.includes(testName)) {
        throw new TypeError(
          `${contract.id} evidence test is missing: ${relativeFile} :: ${testName}`,
        )
      }
      if (evidence.fixtureToken && !source.includes(evidence.fixtureToken)) {
        throw new TypeError(`${contract.id} fixture token is missing from its test.`)
      }
      evidenceCounts[kind] += 1
      if (kind === 'unit') unitFiles.add(relativeFile.replaceAll('\\', '/'))
      if (kind === 'postgresql') {
        const gate = requiredText(evidence.gate, `${contract.id} PostgreSQL gate`)
        if (typeof packageJson.scripts?.[gate] !== 'string') {
          throw new TypeError(`${contract.id} PostgreSQL gate is not a package script.`)
        }
        if (!workflow.includes(`run: npm run ${gate}`)) {
          throw new TypeError(`${contract.id} PostgreSQL gate is not enforced in CI.`)
        }
        postgresqlGates.add(gate)
      }
    }
  }

  return {
    schemaVersion: matrix.schemaVersion,
    matrixHash: createHash('sha256')
      .update(JSON.stringify(matrix))
      .digest('hex'),
    contractCount: matrix.contracts.length,
    evidenceCounts,
    unitFiles: [...unitFiles].sort(),
    postgresqlGates: [...postgresqlGates].sort(),
  }
}

function safeTestPath(value, contractId) {
  const normalized = String(value ?? '').trim().replaceAll('\\', '/')
  if (!normalized.startsWith('src/__tests__/') ||
      !normalized.endsWith('.test.ts') ||
      normalized.includes('..')) {
    throw new TypeError(`${contractId} has an unsafe test path.`)
  }
  return normalized
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

function requiredText(value, label) {
  const normalized = String(value ?? '').trim()
  if (!normalized) throw new TypeError(`${label} is required.`)
  return normalized
}
