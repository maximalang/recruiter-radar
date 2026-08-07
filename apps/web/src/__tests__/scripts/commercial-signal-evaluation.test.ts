import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repositoryRoot = resolve(process.cwd(), '..', '..')
const scriptsRoot = resolve(repositoryRoot, 'packages', 'db', 'scripts')
const evaluatorPath = resolve(
  scriptsRoot,
  'lib',
  'commercial-signal-evaluation.mjs',
)
const cliPath = resolve(scriptsRoot, 'evaluate-commercial-signal-engine.mjs')
const exporterPath = resolve(
  scriptsRoot,
  'export-commercial-signal-evaluation-dataset.mjs',
)
const exportHelperPath = resolve(
  scriptsRoot,
  'lib',
  'commercial-signal-evaluation-export.mjs',
)

describe('Commercial Signal Engine evaluation contract', () => {
  it('runs all dataset manifests and reports v2/v3 without calibration claims', () => {
    const report = JSON.parse(execFileSync(process.execPath, [cliPath], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    }))

    expect(report).toMatchObject({
      schemaVersion: 'commercial-signal-evaluation-report-v1',
      missingDatasetKinds: [],
      calibrationStatus: 'insufficient_data',
      calibrationReasonCodes: [
        'CALIBRATION_REVIEWED_LT_300',
        'CALIBRATION_HOLDOUT_LT_60',
      ],
      comparison: { status: 'contract_only' },
    })
    expect(report.datasets.map((dataset: { kind: string }) => dataset.kind))
      .toEqual([
        'synthetic_contract',
        'anonymized_labeled',
        'holdout',
        'production_shadow',
      ])
    expect(report.datasets[0].models).toEqual(expect.objectContaining({
      recency: expect.any(Object),
      vacancy_count: expect.any(Object),
      old_fiur: expect.any(Object),
      opportunity_v2: expect.any(Object),
      opportunity_v3: expect.any(Object),
    }))
  })

  it('covers ranking, funnel, taxonomy, and yield metrics', () => {
    const evaluator = readFileSync(evaluatorPath, 'utf8')
    for (const contract of [
      'precisionAt5',
      'precisionAt10',
      'ndcgAt10',
      'qualifiedRate',
      'acceptedRate',
      'contactedRate',
      'replyRate',
      'meetingRate',
      'coveragePerAgencyProfile',
      'coveragePerEpisodeType',
      'sourceYield',
      'queryPlanYield',
      'FALSE_POSITIVE_CATEGORIES',
      'internal_recruiting_sufficient',
      'CALIBRATION_MINIMUM_REVIEWED = 300',
    ]) {
      expect(evaluator).toContain(contract)
    }
    expect(evaluator).toContain('automaticWeightTuning: false')
    expect(evaluator).toContain("unavailableMetricValue: null")
  })

  it('keeps real export read-only, workspace-scoped, and pseudonymous', () => {
    const exporter = readFileSync(exporterPath, 'utf8')
    const exportHelper = readFileSync(exportHelperPath, 'utf8')
    expect(exporter).toContain('BEGIN TRANSACTION READ ONLY')
    expect(exporter).toContain("optionValue(args, '--workspace-id')")
    expect(exportHelper).toContain('createHmac')
    expect(exporter).toContain('EVALUATION_ANONYMIZATION_KEY')
    expect(exporter).toContain('LIMIT 5001')
    expect(exporter).not.toMatch(
      /client\.query\(\s*[`'"]\s*(?:INSERT|UPDATE|DELETE|UPSERT)\b/i,
    )
    expect(exporter).not.toMatch(/organization_name|legal_entity_name|email|phone/i)
    expect(exportHelper).not.toMatch(
      /organization_name|legal_entity_name|email|phone/i,
    )
  })
})