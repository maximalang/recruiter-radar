/**
 * lead:generate smoke entry — runs the scoring-pipeline orchestrator on a
 * fixture input and writes the resulting AgencyLead to `.cache/` for
 * inspection. Doubles as a Jest test so it runs in CI alongside everything
 * else and reuses the existing `@/` alias resolution. No DB writes yet —
 * persistence is a separate slice.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import {
  runScoringPipeline,
  type PipelineEvidence,
  type PipelineVacancy,
  type ScoringPipelineInput,
} from '@/lib/scoring/scoring-pipeline'

interface RawVacancy extends Omit<PipelineVacancy, 'publishedAt'> {
  publishedAtHoursAgo?: number
  publishedAt?: string
}

interface RawEvidence extends Omit<PipelineEvidence, 'fetchedAt'> {
  fetchedAtHoursAgo?: number
  fetchedAt?: string | Date
}

interface RawInput extends Omit<ScoringPipelineInput, 'vacancies' | 'evidence' | 'now'> {
  vacancies: RawVacancy[]
  evidence: RawEvidence[]
  now?: string
}

const FIXTURE_PATH = resolve(__dirname, '../../../scripts/fixtures/lead-generate-input.json')
const OUTPUT_PATH = resolve(__dirname, '../../../.cache/lead-generate-output.json')
const FIXED_NOW = new Date('2026-05-28T12:00:00Z')

function hoursAgoToIso(now: Date, hoursAgo: number): string {
  return new Date(now.getTime() - hoursAgo * 3_600_000).toISOString()
}

function hydrate(raw: RawInput, now: Date): ScoringPipelineInput {
  return {
    ...raw,
    vacancies: raw.vacancies.map<PipelineVacancy>((v) => ({
      ...v,
      publishedAt: v.publishedAt ?? hoursAgoToIso(now, v.publishedAtHoursAgo ?? 0),
    })),
    evidence: raw.evidence.map<PipelineEvidence>((e) => ({
      source: e.source,
      tier: e.tier,
      fetchedAt: e.fetchedAt ?? hoursAgoToIso(now, e.fetchedAtHoursAgo ?? 0),
    })),
    now,
  }
}

describe('lead:generate runtime entry', () => {
  it('runs the orchestrator on the fixture and emits a usable AgencyLead', () => {
    const raw: RawInput = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'))
    const input = hydrate(raw, FIXED_NOW)

    const result = runScoringPipeline(input)

    expect(result.lead.id).toBe(raw.leadId)
    expect(result.lead.score).toBeGreaterThan(0)
    expect(result.lead.confidence).toMatch(/^[ABCD]$/)
    expect(['outreach', 'enrich-contacts', 'review', 'wait']).toContain(
      result.lead.nextAction.kind
    )
    expect(result.lead.sources.length).toBeGreaterThan(0)
    expect(result.breakdown.fiur.total).toBe(result.lead.score)

    mkdirSync(dirname(OUTPUT_PATH), { recursive: true })
    writeFileSync(
      OUTPUT_PATH,
      JSON.stringify(
        {
          generatedAt: FIXED_NOW.toISOString(),
          lead: result.lead,
          breakdown: result.breakdown,
        },
        null,
        2
      ),
      'utf8'
    )
    expect(existsSync(OUTPUT_PATH)).toBe(true)
  })

  it('produces a high-confidence outreach lead for the canonical fixture', () => {
    const raw: RawInput = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'))
    const result = runScoringPipeline(hydrate(raw, FIXED_NOW))

    expect(result.lead.confidence).toBe('A')
    expect(result.lead.nextAction.kind).toBe('outreach')
    expect(result.breakdown.sourceAggregation.hasMultiSourceConfirmation).toBe(true)
    expect(result.breakdown.freshness.meetsSla).toBe(true)
    expect(result.breakdown.contactQuality.hasHrChannel).toBe(true)
  })
})
