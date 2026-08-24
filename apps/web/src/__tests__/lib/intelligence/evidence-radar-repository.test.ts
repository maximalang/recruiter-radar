import { listEvidenceRadarLeads } from '@/lib/intelligence/evidence-radar-repository'

describe('Evidence Radar repository qualification boundary', () => {
  it('only exposes actionable verified and live leads on the Radar surface', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] })

    await expect(listEvidenceRadarLeads(
      { workspaceId: '42', limit: 500 },
      { query } as never,
    )).resolves.toEqual([])

    expect(query).toHaveBeenCalledTimes(1)
    const [sql, params] = query.mock.calls[0] as [string, unknown[]]
    expect(params).toEqual(['42', 200])
    expect(sql).toContain("card.status = 'qualified'")
    expect(sql).toContain('card.valid_until >= NOW()')
    expect(sql).toContain('score.valid_until >= NOW()')
    expect(sql).toContain("identity.resolution_status = 'verified'")
    expect(sql).toContain("location.verification_status = 'verified'")
    expect(sql).toContain("event.verification_status = 'verified'")
    expect(sql).toContain('event.valid_until >= NOW()')
    expect(sql).toContain("contact.verification_status = 'verified'")
    expect(sql).not.toContain("card.status IN ('qualified', 'review')")
  })

  it('keeps the caller limit bounded for a stable radar payload', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] })

    await listEvidenceRadarLeads(
      { workspaceId: 7, limit: -10 },
      { query } as never,
    )

    const [, params] = query.mock.calls[0] as [string, unknown[]]
    expect(params).toEqual(['7', 1])
  })

  it('removes unsafe outbound URLs before Evidence Radar renders them', async () => {
    const row = {
      cardId: 'card-1', organizationId: 'org-1', organizationName: 'Acme', legalName: null,
      domain: 'acme.ru', title: 'Hiring', whyNow: 'Hiring spike', recommendedAction: 'Contact',
      recommendedContactAt: null, validUntil: '2026-09-01', city: 'Москва', federalSubjectCode: '77',
      federalSubjectName: 'Москва', address: null, latitude: 55.75, longitude: 37.61, geoConfidence: 1,
      locationType: 'city', leadScore: 90, opportunityScore: 85, confidenceScore: 90,
      urgencyScore: 80, contactabilityScore: 70, riskScore: 10, components: {}, contributions: [],
      staffingNeed: null, specialization: null, independentSourceCount: 1,
      evidence: [
        { id: 'e1', eventType: 'vacancy', sourceRegistryId: 's1', sourceFamily: 'career', occurredAt: '2026-08-18', detectedAt: '2026-08-18', canonicalUrl: 'javascript:alert(1)', confidence: 1, primarySource: true },
        { id: 'e2', eventType: 'vacancy', sourceRegistryId: 's2', sourceFamily: 'career', occurredAt: '2026-08-18', detectedAt: '2026-08-18', canonicalUrl: 'https://acme.ru/jobs', confidence: 1, primarySource: true },
      ],
      contactPaths: [
        { id: 'c1', type: 'form', label: 'Bad', href: 'data:text/html,boom' },
        { id: 'c2', type: 'email', label: 'HR', href: 'mailto:hr@acme.ru' },
        { id: 'c3', type: 'phone', label: 'Phone', href: 'tel:+74951234567' },
      ],
      riskReasons: [], temporalEvents: [],
    }
    const query = jest.fn().mockResolvedValue({ rows: [row] })

    const [lead] = await listEvidenceRadarLeads({ workspaceId: '42' }, { query } as never)

    expect(lead.evidence.map((item) => item.canonicalUrl)).toEqual([null, 'https://acme.ru/jobs'])
    expect(lead.contactPaths.map((item) => item.href)).toEqual([null, 'mailto:hr@acme.ru', 'tel:+74951234567'])
  })
})