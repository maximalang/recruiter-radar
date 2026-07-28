/** @jest-environment node */

import fs from 'node:fs'
import path from 'node:path'

describe('opportunity outcome production canary', () => {
  it('is owner scoped, dry-run by default, and emits no private fields', () => {
    const source = fs.readFileSync(path.resolve(
      process.cwd(),
      '../../packages/db/scripts/canary-opportunity-outcomes.mjs',
    ), 'utf8')

    expect(source).toContain("'--owner-id'")
    expect(source).toContain("'--pre-activation'")
    expect(source).toContain("phase: preActivation ? 'pre_activation' : 'active'")
    expect(source).toContain('activationReady')
    expect(source).toContain("mode: apply ? 'apply' : 'dry_run'")
    expect(source).toContain('projectionDrift')
    expect(source).toContain('cohortProjectionMismatches')
    expect(source).toContain('ownerOpportunityCount')
    expect(source).toContain('rawContactRows')
    expect(source).toContain('contact_reference_label IS NOT NULL')
    expect(source).toContain('invalidMeetingLifecycles')
    expect(source).toContain('externalIngestEnabled')
    expect(source).not.toContain('contactReferenceLabel')
    expect(source).not.toContain('reasonNote')
    expect(source).not.toContain('dealValueMinor')
    expect(source).toContain('process.exitCode = 2')
    expect(source).toContain('correction_boundary')
  })
})
