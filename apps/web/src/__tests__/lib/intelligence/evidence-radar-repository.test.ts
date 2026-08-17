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

  it('derives the displayed independent-source count from the same live evidence rows', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] })

    await listEvidenceRadarLeads(
      { workspaceId: '42' },
      { query } as never,
    )

    const [sql] = query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('COUNT(DISTINCT event.source_family)::INTEGER AS source_count')
    expect(sql).toContain('COALESCE(evidence.source_count, 0)::INTEGER AS "independentSourceCount"')
    expect(sql).not.toContain('CARDINALITY(score.independent_source_families)')
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
})