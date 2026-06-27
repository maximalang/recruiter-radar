import { renderDigestEmail } from '@/lib/email/digestEmail'
import type { LeadItem } from '@/lib/leads-data'

/** Minimal LeadItem factory — only the fields the renderer reads matter. */
function makeLead(overrides: Partial<LeadItem> = {}): LeadItem {
  return {
    id: 'lead-1',
    orgId: 'org-1',
    orgName: 'Ромашка',
    sourceExternalId: null,
    score: 3.2,
    confidenceGate: 'A',
    vacanciesCount: 2,
    distinctVacancyNamesCount: 2,
    latestPublishedAt: null,
    reasons: [],
    whyNow: 'Открыли 2 новые вакансии за неделю',
    bestAngle: 'Подбор IT',
    lawfulContactPath: 'Карьерная страница',
    negativeSignals: [],
    opener: '',
    feedbackStatus: null,
    suppressedUntil: null,
    createdAt: '2026-06-27T00:00:00.000Z',
    sourceFamilies: ['career-pages'],
    evidenceTitles: ['Backend-разработчик', 'DevOps'],
    locationNames: ['Москва'],
    ...overrides,
  }
}

const ctx = { profileName: 'Агентство Альфа', appBaseUrl: 'https://app.example.com' }

describe('renderDigestEmail', () => {
  it('renders subject, html and text for a single lead', () => {
    const out = renderDigestEmail([makeLead()], ctx)

    expect(out.subject).toContain('1 компания')
    expect(out.subject).toContain('Агентство Альфа')
    expect(out.html).toContain('Ромашка')
    expect(out.html).toContain('Почему сейчас')
    expect(out.html).toContain('Готов к контакту')
    expect(out.text).toContain('Ромашка')
    expect(out.text).toContain('Почему сейчас')
  })

  it('links each card to the lead surface using the app base URL', () => {
    const out = renderDigestEmail([makeLead({ id: 'abc-123' })], ctx)
    expect(out.html).toContain('https://app.example.com/leads/abc-123')
    expect(out.text).toContain('https://app.example.com/leads/abc-123')
  })

  it('escapes HTML-significant characters in dynamic strings', () => {
    const out = renderDigestEmail(
      [makeLead({ orgName: 'Roma <b>& "Co"</b>', whyNow: '5 > 3 & growing' })],
      ctx,
    )
    // Raw markup from data must not survive into the HTML.
    expect(out.html).not.toContain('<b>& "Co"</b>')
    expect(out.html).toContain('&lt;b&gt;')
    expect(out.html).toContain('&amp;')
    expect(out.html).toContain('5 &gt; 3 &amp; growing')
  })

  it('orders A/B leads before lower gates, then by score', () => {
    const leads = [
      makeLead({ id: 'c1', orgName: 'C-low', confidenceGate: 'C', score: 3.9 }),
      makeLead({ id: 'b1', orgName: 'B-mid', confidenceGate: 'B', score: 2.0 }),
      makeLead({ id: 'a1', orgName: 'A-top', confidenceGate: 'A', score: 1.0 }),
      makeLead({ id: 'a2', orgName: 'A-higher', confidenceGate: 'A', score: 3.5 }),
    ]
    const out = renderDigestEmail(leads, ctx)
    const order = ['A-higher', 'A-top', 'B-mid', 'C-low'].map((n) => out.text.indexOf(n))
    // Every name present and in strictly increasing position.
    expect(order.every((i) => i >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((x, y) => x - y))
  })

  it('pluralizes the company count correctly in Russian', () => {
    const two = renderDigestEmail([makeLead({ id: 'a' }), makeLead({ id: 'b' })], ctx)
    expect(two.subject).toContain('2 компании')

    const five = renderDigestEmail(
      Array.from({ length: 5 }, (_, i) => makeLead({ id: `l${i}` })),
      ctx,
    )
    expect(five.subject).toContain('5 компаний')
  })

  it('renders a gate label for review (C) leads', () => {
    const out = renderDigestEmail([makeLead({ confidenceGate: 'C' })], ctx)
    expect(out.html).toContain('На проверку')
    expect(out.text).toContain('На проверку')
  })

  it('omits optional sections when their fields are empty', () => {
    const out = renderDigestEmail(
      [
        makeLead({
          whyNow: '',
          evidenceTitles: [],
          locationNames: [],
          lawfulContactPath: null,
          sourceFamilies: [],
          vacanciesCount: 0,
        }),
      ],
      ctx,
    )
    expect(out.html).not.toContain('Почему сейчас')
    expect(out.html).not.toContain('Источники')
    // Header (company + readiness) and the action link still render.
    expect(out.html).toContain('Ромашка')
    expect(out.html).toContain('Открыть карточку')
  })
})
