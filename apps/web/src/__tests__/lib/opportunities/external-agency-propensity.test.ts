import {
  buildExternalAgencyPropensity,
  EXTERNAL_AGENCY_PROPENSITY_FEATURE_VERSION,
  type ExternalAgencyPropensityInput,
} from '@/lib/opportunities/external-agency-propensity'

const NOW = new Date('2026-08-04T12:00:00.000Z')

function input(
  overrides: Partial<ExternalAgencyPropensityInput> = {},
): ExternalAgencyPropensityInput {
  return {
    organizationId: '10',
    workspaceId: '20',
    ownerId: '30',
    clientProfileId: '40',
    commercialThesisId: '50',
    commercialThesisGeneration: 1,
    thesisIdentity: '1'.repeat(64),
    thesisInputHash: '2'.repeat(64),
    thesisEvidenceHash: '3'.repeat(64),
    agencyDnaVersion: 4,
    agencyDnaSnapshotHash: '4'.repeat(64),
    episodeType: 'recruiting_capacity_gap',
    episodeIntensity: 0.86,
    episodeLastSeenAt: '2026-08-04T10:00:00.000Z',
    episodeValidUntil: '2026-08-25T10:00:00.000Z',
    roleFamilies: ['backend', 'data'],
    seniorityDistribution: { senior: 2, lead: 1 },
    evidenceIds: ['101', '102'],
    evidenceSourceFamilies: ['career-pages', 'hh'],
    accountRestriction: null,
    ...overrides,
  }
}

describe('External Agency Propensity v1', () => {
  it('classifies a strong recruiting-capacity gap as high without a probability', () => {
    const result = buildExternalAgencyPropensity(input(), { now: NOW })

    expect(result.level).toBe('high')
    expect(result.score).toBeGreaterThanOrEqual(0.68)
    expect(result.positiveReasons.map((reason) => reason.code)).toEqual(
      expect.arrayContaining([
        'RECRUITING_CAPACITY_GAP',
        'HIGH_EPISODE_INTENSITY',
        'MULTI_ROLE_COMPLEXITY',
        'SENIORITY_COMPLEXITY',
        'INDEPENDENT_EVIDENCE',
      ]),
    )
    expect(result.featureVersion).toBe(
      EXTERNAL_AGENCY_PROPENSITY_FEATURE_VERSION,
    )
    expect(result.evidenceIds).toEqual(['101', '102'])
    expect(result).not.toHaveProperty('probability')
    expect(result).not.toHaveProperty('status')
    expect(result).not.toHaveProperty('eligibility')
  })

  it('caps a single-source acceleration at medium and records the limitation', () => {
    const result = buildExternalAgencyPropensity(input({
      episodeType: 'vacancy_acceleration',
      roleFamilies: ['backend'],
      evidenceIds: ['101'],
      evidenceSourceFamilies: ['career-pages'],
    }), { now: NOW })

    expect(result.level).toBe('medium')
    expect(result.negativeReasons).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'EVIDENCE_INDEPENDENCE_LIMITED',
        basis: 'evidence',
        evidenceIds: ['101'],
      }),
    ]))
  })

  it('recomputes lifecycle stage and never upgrades cooling or expired evidence', () => {
    const cooling = buildExternalAgencyPropensity(input({
      episodeLastSeenAt: '2026-08-01T00:00:00.000Z',
      episodeValidUntil: '2026-08-05T00:00:00.000Z',
    }), { now: NOW })
    expect(cooling.featureSnapshot.episodeStage).toBe('cooling')
    expect(cooling.level).toBe('medium')
    expect(cooling.negativeReasons.map((reason) => reason.code))
      .toContain('EPISODE_COOLING')

    const expired = buildExternalAgencyPropensity(input({
      episodeValidUntil: '2026-08-04T11:59:59.000Z',
    }), { now: NOW })
    expect(expired.featureSnapshot.episodeStage).toBe('expired')
    expect(expired.level).toBe('insufficient_evidence')
    expect(expired.score).toBe(0)
    expect(expired.negativeReasons.map((reason) => reason.code))
      .toContain('EPISODE_EXPIRED')
  })

  it.each([
    ['existing_client', 'KNOWN_EXTERNAL_AGENCY_USE', 'grow'],
    ['former_client', 'HISTORICAL_EXTERNAL_AGENCY_USE', 'reactivate'],
  ] as const)(
    'uses %s only as versioned agency-profile evidence',
    (accountRestriction, reasonCode, opportunityMode) => {
      const result = buildExternalAgencyPropensity(input({
        episodeType: 'role_cluster',
        episodeIntensity: 0.62,
        roleFamilies: ['backend'],
        evidenceIds: ['101'],
        evidenceSourceFamilies: ['hh'],
        accountRestriction,
      }), { now: NOW })

      expect(result.featureSnapshot.opportunityMode).toBe(opportunityMode)
      expect(result.positiveReasons).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: reasonCode,
          basis: 'agency_profile',
          evidenceIds: [],
        }),
      ]))
    },
  )

  it.each(['do_not_contact', 'conflict'] as const)(
    'floors %s to low without turning policy into company evidence',
    (accountRestriction) => {
      const result = buildExternalAgencyPropensity(input({
        accountRestriction,
      }), { now: NOW })

      expect(result.level).toBe('low')
      expect(result.score).toBe(0)
      expect(result.featureSnapshot.opportunityMode).toBe('blocked')
      expect(result.negativeReasons).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: accountRestriction === 'conflict'
            ? 'ACCOUNT_CONFLICT'
            : 'DO_NOT_CONTACT',
          basis: 'policy',
          evidenceIds: [],
        }),
      ]))
    },
  )

  it('returns insufficient evidence when source-family provenance is unavailable', () => {
    const result = buildExternalAgencyPropensity(input({
      evidenceSourceFamilies: [],
    }), { now: NOW })

    expect(result.level).toBe('insufficient_evidence')
    expect(result.negativeReasons.map((reason) => reason.code))
      .toContain('EVIDENCE_SOURCE_FAMILY_MISSING')
  })

  it('is deterministic and order-independent for set-like inputs', () => {
    const left = buildExternalAgencyPropensity(input(), { now: NOW })
    const right = buildExternalAgencyPropensity(input({
      roleFamilies: ['data', 'backend', 'backend'],
      seniorityDistribution: { lead: 1, senior: 2 },
      evidenceIds: ['102', '101', '101'],
      evidenceSourceFamilies: ['hh', 'career-pages', 'hh'],
    }), { now: NOW })

    expect(right).toEqual(left)
    expect(right.inputHash).toMatch(/^[a-f0-9]{64}$/)
    expect(right.propensityIdentity).toMatch(/^[a-f0-9]{64}$/)
  })

  it('orders PostgreSQL BIGINT evidence ids without Number precision loss', () => {
    const lower = '9007199254740992'
    const higher = '9007199254740993'
    const left = buildExternalAgencyPropensity(input({
      evidenceIds: [higher, lower],
    }), { now: NOW })
    const right = buildExternalAgencyPropensity(input({
      evidenceIds: [lower, higher],
    }), { now: NOW })

    expect(left.evidenceIds).toEqual([lower, higher])
    expect(left).toEqual(right)
  })

  it.each([
    [{ organizationId: '0' }, 'organization'],
    [{ commercialThesisGeneration: 0 }, 'generation'],
    [{ thesisEvidenceHash: 'not-a-hash' }, 'hash'],
    [{ agencyDnaSnapshotHash: 'not-a-hash' }, 'hash'],
    [{ episodeIntensity: 1.1 }, 'intensity'],
    [{ evidenceIds: [] }, 'evidence'],
    [{ episodeValidUntil: 'invalid-date' }, 'date'],
  ] as const)('rejects invalid boundary input %p', (override, message) => {
    expect(() => buildExternalAgencyPropensity(
      input(override as Partial<ExternalAgencyPropensityInput>),
      { now: NOW },
    )).toThrow(new RegExp(message, 'i'))
  })
})
