import { execFileSync } from 'node:child_process'
import path from 'node:path'

describe('FIUR offline evaluation harness', () => {
  test('emits a versioned deterministic report with required metrics', () => {
    const stdout = execFileSync(
      process.execPath,
      [path.resolve(process.cwd(), 'scripts/evaluate-fiur.mjs')],
      { encoding: 'utf8' },
    )
    const report = JSON.parse(stdout)

    expect(report).toMatchObject({
      schemaVersion: 1,
      datasetVersion: 'fixture-2026-07-20-v1',
      scoringVersion: 'fiur-additive-v1',
      generatedAt: 'deterministic-fixture',
      sampleSize: 8,
    })
    expect(report.disclaimer).toContain('not production quality claims')
    expect(report.metrics).toEqual(expect.objectContaining({
      precisionAt3: expect.any(Number),
      precisionAt5: expect.any(Number),
      falsePositiveRate: expect.any(Number),
      entityResolutionErrorRate: expect.any(Number),
      actualHiringRate: expect.any(Number),
      freshSignalRate: expect.any(Number),
      evidenceIndependenceRate: expect.any(Number),
      lawfulContactPathRate: expect.any(Number),
    }))
    expect(report.gateCalibration).toEqual(expect.objectContaining({ A: expect.any(Object), B: expect.any(Object), C: expect.any(Object), D: expect.any(Object) }))
    expect(report.sourceCoverage).toEqual(expect.objectContaining({ hh: expect.any(Number), 'career-pages': expect.any(Number) }))
    expect(report.outcomesByScoreBand).toEqual(expect.objectContaining({ hot: expect.any(Object), warm: expect.any(Object), cold: expect.any(Object) }))
    expect(report.outcomesByGate).toEqual(expect.objectContaining({ A: expect.any(Object), B: expect.any(Object), C: expect.any(Object), D: expect.any(Object) }))
  })

  test('supports markdown output without hiding dataset/scoring versions', () => {
    const stdout = execFileSync(
      process.execPath,
      [path.resolve(process.cwd(), 'scripts/evaluate-fiur.mjs'), '--format', 'markdown'],
      { encoding: 'utf8' },
    )
    expect(stdout).toContain('fixture-2026-07-20-v1')
    expect(stdout).toContain('fiur-additive-v1')
    expect(stdout).toContain('precisionAt3')
  })
})
