import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const scriptsRoot = resolve(process.cwd(), '..', '..', 'packages', 'db', 'scripts')
const evaluator = readFileSync(
  resolve(scriptsRoot, 'lib', 'opportunity-scoring-evaluation.mjs'),
  'utf8',
)
const cli = readFileSync(
  resolve(scriptsRoot, 'evaluate-opportunity-scoring-v2.mjs'),
  'utf8',
)

describe('Opportunity Scoring v2 evaluation contract', () => {
  it('reports every required offline comparison metric', () => {
    for (const metric of [
      'precisionAt5',
      'precisionAt10',
      'ndcgAt10',
      'acceptanceRate',
      'contactRate',
      'replyRate',
      'meetingRate',
      'badFitReasonDistribution',
      'falsePositiveTaxonomy',
      'sourceFamilyPerformance',
      'episodeTypePerformance',
    ]) {
      expect(evaluator).toContain(metric)
    }
  })

  it('keeps small samples explicit and never auto-tunes weights', () => {
    expect(evaluator).toContain("'insufficient_data'")
    expect(evaluator).toContain('absoluteCounts')
    expect(evaluator).toContain("evaluationPopulation: 'labeled_outcomes_only'")
    expect(evaluator).toContain('automaticWeightTuning: false')
    expect(evaluator).not.toMatch(/UPDATE\s+.*scor|INSERT\s+INTO\s+.*config/i)
  })

  it('reads one workspace and emits no company or contact identity', () => {
    expect(cli).toContain("requireWorkspaceId(args)")
    expect(cli).toContain('snapshot.workspace_id = $1')
    expect(cli).toContain('snapshot.comparison_input_hash AS "sampleKey"')
    expect(cli).not.toMatch(/organization_name|agency_name|contact_reference|email|phone/i)
    expect(cli).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bINSERT\b/i)
  })

  it('fails evidence safety when an action-eligible row has a failed gate', () => {
    expect(evaluator).toContain('actionQueueSafetyViolations')
    expect(evaluator).toContain('failedHardGateCount')
    expect(evaluator).toContain('confidenceGateViolationCount')
  })
})
