/**
 * buildHhDigestText — the fallback digest renderer used by lib/payments.ts
 * when the batch builder yields nothing. It is sent with parse_mode=HTML,
 * so it must (a) carry Telegram-HTML formatting and (b) escape every
 * employer-derived string so external data can never break or inject markup.
 *
 * The heavy data modules are mocked out: this test exercises the pure
 * renderer only.
 */

jest.mock('@/lib/digest', () => ({
  getDigestPreviewItems: jest.fn(),
  getDigestItemsForClientProfile: jest.fn(),
}))

jest.mock('@/lib/scoring/gate-pipeline', () => ({
  isDigestEligibleGate: jest.fn(() => true),
}))

import { buildHhDigestText, type HhDigestItem } from '@/lib/hhDigest'

function item(overrides: Partial<HhDigestItem> = {}): HhDigestItem {
  return {
    rank: 1,
    org_id: '1',
    hh_employer_id: '101',
    employer_name: 'Ромашка',
    vacancies_count: 4,
    distinct_vacancy_names_count: 3,
    latest_published_at: '2026-09-01T00:00:00Z',
    total_score: 320.4,
    reasons: ['нанимают по вашему профилю', 'свежие вакансии за неделю'],
    opener: 'напишите о подборе бэкенд-инженеров',
    source_families: ['hh'],
    evidence_titles: ['Backend разработчик'],
    candidate_source_keys: [],
    location_names: ['Москва'],
    confidence_gate: 'A',
    ...overrides,
  }
}

describe('buildHhDigestText — Telegram HTML standard', () => {
  it('wraps the header, company name and the «Что делать» label in bold tags', () => {
    const text = buildHhDigestText([item()])
    expect(text).toContain('<b>HH digest</b>')
    expect(text).toContain('<b>1. Ромашка</b>')
    expect(text).toContain('<b>Что делать:</b> напишите о подборе бэкенд-инженеров')
  })

  it('keeps the data lines: rank, vacancy count, score and bullet reasons', () => {
    const text = buildHhDigestText([item()])
    expect(text).toContain('4 вакансий · score 320.4')
    expect(text).toContain('• нанимают по вашему профилю')
    expect(text).toContain('• свежие вакансии за неделю')
  })

  it('escapes ampersand and angle brackets in the employer name', () => {
    const text = buildHhDigestText([item({ employer_name: 'A & B <Co>' })])
    expect(text).toContain('<b>1. A &amp; B &lt;Co&gt;</b>')
    expect(text).not.toContain('A & B')
    expect(text).not.toContain('<Co>')
  })

  it('escapes markup in the reasons and drops blank entries', () => {
    // reasons is a [string, string] tuple — keep exactly two entries;
    // the blank one still exercises the whitespace filter.
    const text = buildHhDigestText([
      item({ reasons: ['<b>injected</b> & Co', '  '] }),
    ])
    expect(text).toContain('• &lt;b&gt;injected&lt;/b&gt; &amp; Co')
    expect(text).not.toContain('• <b>')
  })

  it('escapes markup in the opener phrase', () => {
    const text = buildHhDigestText([
      item({ opener: 'напишите в <telegram> & перезвоните' }),
    ])
    expect(text).toContain('напишите в &lt;telegram&gt; &amp; перезвоните')
    expect(text).not.toContain('<telegram>')
  })

  it('never lets employer data close the bold tag or inject markup', () => {
    const text = buildHhDigestText([
      item({ employer_name: 'X</b><a href="evil">y' }),
    ])
    // The injected sequence must survive only in escaped form.
    expect(text).not.toContain('</b><a')
    expect(text).toContain('&lt;/b&gt;&lt;a href="evil"&gt;y')
  })

  it('drops items once the 4096-char Telegram limit would be exceeded', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      item({
        rank: i + 1,
        org_id: String(i + 1),
        employer_name: `Компания с довольно длинным названием номер ${i + 1}`,
        reasons: [
          'нанимают сразу по нескольким вашим ключевым направлениям подбора',
          'свежие вакансии за последнюю неделю по вашему профилю',
        ],
        opener: 'напишите о подборе специалистов под текущие открытые позиции компании',
      }),
    )
    const text = buildHhDigestText(many)
    expect(text.length).toBeLessThanOrEqual(4096)
    expect(text).toContain('<b>1. ')
    // Some trailing items must be dropped, not truncated mid-block.
    expect(text).not.toContain('<b>40. ')
  })

  it('renders only the header for an empty digest', () => {
    expect(buildHhDigestText([])).toBe('<b>HH digest</b>')
  })
})
