/**
 * Mode-aware surface smoke (2026-07-06).
 *
 * Documents the end-to-end difference an agency's hiringMode makes across the
 * real user-facing surfaces: urgency cue (lead list/detail/dashboard), why-match
 * (Telegram card), and the batch digest block. An executive, volume, and
 * specialist agency seeing the SAME lead must read different, correct framing.
 */
import { deriveUrgencyCue } from '@/lib/leads/lead-quality'
import { buildWhyMatch } from '@/lib/leads/why-match'
import { formatBatchLeadBlock, type BatchLead } from '@/lib/telegram/digest-batch'

const fresh = new Date().toISOString()
const stale20 = new Date(Date.now() - 20 * 86400000).toISOString()

const baseLead = {
  orgName: 'Ромашка',
  evidenceTitles: ['Финансовый директор'],
  locationNames: ['Москва'],
  vacanciesCount: 12,
  score: 3.4,
  latestSignalAt: fresh,
}

const baseBatch: BatchLead = {
  orgId: '1',
  orgName: 'Ромашка',
  score: 330,
  confidenceGate: 'A',
  vacanciesCount: 12,
  evidenceTitles: ['Финансовый директор'],
  locationNames: ['Москва'],
  isForeignEmployer: false,
  careerPageUrl: 'https://r.ru/career',
  orgWebsite: 'https://r.ru',
  orgDomain: 'r.ru',
  contactPathLabel: null,
  sourceFamilies: ['career-pages'],
}

describe('mode-aware surfaces: same lead, three agency types', () => {
  it('executive agency sees freshness + seniority framing, NOT volume count', () => {
    const urgency = deriveUrgencyCue({ vacanciesCount: 12, latestPublishedAt: stale20, hiringMode: 'executive' })
    expect(urgency.label).not.toContain('12')

    const why = buildWhyMatch(baseLead, {
      roles: ['executive'], industries: [], targetCity: 'Москва',
      minOpenRoles: null, hiringIntentMin: null, remoteFriendly: false, hiringMode: 'executive',
    })
    expect(why[0]).toContain('руководителя')

    const block = formatBatchLeadBlock({ ...baseBatch, latestPublishedAt: fresh, hiringMode: 'executive' }, 1)
    expect(block).toContain('Свежая вакансия за неделю')
    expect(block).not.toMatch(/Активный найм.*12/)
  })

  it('volume agency sees hiring-scale framing', () => {
    const urgency = deriveUrgencyCue({ vacanciesCount: 12, latestPublishedAt: stale20, hiringMode: 'volume' })
    expect(urgency.label).toContain('12')

    const why = buildWhyMatch(baseLead, {
      roles: [], industries: [], targetCity: 'Москва',
      minOpenRoles: null, hiringIntentMin: null, remoteFriendly: false, hiringMode: 'volume',
    })
    expect(why.some((l) => l.includes('Масштаб найма') && l.includes('12'))).toBe(true)

    const block = formatBatchLeadBlock({ ...baseBatch, latestPublishedAt: stale20, hiringMode: 'volume' }, 1)
    expect(block).toContain('Активный найм')
    expect(block).toContain('12')
  })

  it('specialist agency keeps the default ladder — no seniority/scale emphasis', () => {
    const urgency = deriveUrgencyCue({ vacanciesCount: 12, latestPublishedAt: stale20, hiringMode: 'specialist' })
    expect(urgency.level).toBe('active')

    const why = buildWhyMatch(baseLead, {
      roles: [], industries: [], targetCity: 'Москва',
      minOpenRoles: null, hiringIntentMin: null, remoteFriendly: false, hiringMode: 'specialist',
    })
    expect(why.some((l) => l.includes('руководителя'))).toBe(false)
    expect(why.some((l) => l.includes('Масштаб найма'))).toBe(false)
  })
})
