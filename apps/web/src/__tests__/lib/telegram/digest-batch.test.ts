import {
  buildBatchDigestMessages,
  formatBatchLeadBlock,
  TELEGRAM_MESSAGE_CHAR_LIMIT,
  MAX_BATCH_MESSAGES,
  type BatchLead,
} from '@/lib/telegram/digest-batch'

function lead(overrides: Partial<BatchLead> = {}): BatchLead {
  return {
    orgId: '1',
    orgName: 'Ромашка',
    score: 320,
    confidenceGate: 'A',
    vacanciesCount: 4,
    evidenceTitles: ['Backend разработчик', 'DevOps инженер'],
    locationNames: ['Москва'],
    whyLine: 'нанимают по вашему профилю',
    isForeignEmployer: false,
    careerPageUrl: 'https://romashka.ru/career',
    orgWebsite: 'https://romashka.ru',
    orgDomain: 'romashka.ru',
    contactPathLabel: 'Карьерная страница компании — прямой путь к HR',
    sourceFamilies: ['career-pages', 'habr'],
    ...overrides,
  }
}

const LEADS_URL = 'https://app.example.com/leads'

describe('formatBatchLeadBlock', () => {
  it('renders a numbered block with company, readiness, why, roles', () => {
    const block = formatBatchLeadBlock(lead(), 1)
    expect(block).toContain('1.')
    expect(block).toContain('<b>Ромашка</b>')
    expect(block).toContain('Москва')
    expect(block).toContain('Готов к контакту')
    expect(block).toContain('Горячий')
    expect(block).toContain('сигнал 3.2')
    expect(block).toContain('Роли:')
    expect(block).toContain('Backend разработчик')
    expect(block).toContain('нанимают по вашему профилю')
  })

  // ─── T6.1 readiness-line de-duplication (2026-07-08) ──────────────────────
  // The readiness line must carry ≤2 confidence readouts — readinessLabel +
  // band + numeric. The gate letter (A/B/C) is encoded in readinessLabel
  // («Готов к контакту» vs «На проверку»), so it is dropped to avoid the
  // triple-readout drift. One contract shared with the email renderer (T6.2).
  it('drops the redundant gate letter from the readiness line', () => {
    const block = formatBatchLeadBlock(lead(), 1)
    expect(block).toContain('Готов к контакту · Горячий · сигнал 3.2')
    expect(block).not.toMatch(/Готов к контакту · A/)
    expect(block).not.toMatch(/· A ·/)
  })

  it('keeps ≤2 confidence readouts on the readiness line', () => {
    const block = formatBatchLeadBlock(lead(), 1)
    const readinessLine = block.split('\n')[1] ?? ''
    // Confidence readouts = readinessLabel + band + signal. Gate letter must
    // not be a fourth. Assert the exact expected contract form.
    expect(readinessLine).toBe('Готов к контакту · Горячий · сигнал 3.2')
  })

  it('reads readiness «На проверку» without a gate letter for gate C', () => {
    const block = formatBatchLeadBlock(lead({ confidenceGate: 'C' }), 1)
    const readinessLine = block.split('\n')[1] ?? ''
    expect(readinessLine).toBe('На проверку · Горячий · сигнал 3.2')
    expect(block).not.toMatch(/· C\b/)
  })

  it('renders the reachable contact surface as links', () => {
    const block = formatBatchLeadBlock(lead(), 1)
    expect(block).toContain('Контакт:')
    expect(block).toContain('<a href="https://romashka.ru/career">Карьерная страница</a>')
    expect(block).toContain('romashka.ru')
  })

  it('falls back to the lawful-path label when no direct link is present', () => {
    const block = formatBatchLeadBlock(
      lead({ careerPageUrl: null, orgWebsite: null, orgDomain: null }),
      1,
    )
    expect(block).toContain('Контакт: Карьерная страница компании — прямой путь к HR')
  })

  it('states plainly when there is no known contact surface — never invents one', () => {
    const block = formatBatchLeadBlock(
      lead({ careerPageUrl: null, orgWebsite: null, orgDomain: null, contactPathLabel: null }),
      1,
    )
    expect(block).toContain('Контакт: прямой путь уточняется')
  })

  it('renders the sources trust line', () => {
    expect(formatBatchLeadBlock(lead(), 1)).toContain('Источники: career-pages, habr')
  })

  it('reads readiness "на проверку" for gate C', () => {
    const block = formatBatchLeadBlock(lead({ confidenceGate: 'C' }), 1)
    expect(block).toContain('На проверку')
    expect(block).not.toContain('Готов к контакту')
  })

  it('marks a foreign employer with a quiet textual tag (no emoji)', () => {
    expect(formatBatchLeadBlock(lead({ isForeignEmployer: true }), 2)).toContain('зарубежный ATS')
    expect(formatBatchLeadBlock(lead({ isForeignEmployer: false }), 2)).not.toContain('зарубежный ATS')
  })

  it('omits the roles line when there are no roles', () => {
    expect(formatBatchLeadBlock(lead({ evidenceTitles: [] }), 1)).not.toContain('Роли:')
  })

  it('escapes HTML in the company name', () => {
    const block = formatBatchLeadBlock(lead({ orgName: 'A & B <Co>' }), 1)
    expect(block).toContain('A &amp; B &lt;Co&gt;')
  })

  it('carries no outreach / first-contact draft content', () => {
    const block = formatBatchLeadBlock(lead(), 1)
    expect(block).not.toContain('Здравствуйте')
    expect(block).not.toContain('созвон')
    expect(block).not.toMatch(/перв\w+ сообщени/i)
    expect(block).not.toContain('Что делать')
  })

  // ─── Mode-aware urgency line (2026-07-06) ───────────────────────────────

  it('executive mode renders freshness-shaped urgency, not volume count', () => {
    const block = formatBatchLeadBlock(
      lead({
        vacanciesCount: 12,
        latestPublishedAt: new Date().toISOString(),
        hiringMode: 'executive',
      }),
      1,
    )
    // A fresh single posting reads as urgency for an executive agency.
    expect(block).toContain('Свежая вакансия за неделю')
    // The volume count is NOT the urgency framing for an executive agency.
    expect(block).not.toMatch(/Активный найм.*12/)
  })

  it('volume mode renders hiring-scale urgency for many open roles', () => {
    const block = formatBatchLeadBlock(
      lead({
        vacanciesCount: 12,
        latestPublishedAt: new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString(),
        hiringMode: 'volume',
      }),
      1,
    )
    expect(block).toContain('Активный найм')
    expect(block).toContain('12')
  })

  it('specialist mode (default) keeps the pre-mode urgency ladder', () => {
    const block = formatBatchLeadBlock(
      lead({
        vacanciesCount: 12,
        latestPublishedAt: new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString(),
        hiringMode: 'specialist',
      }),
      1,
    )
    expect(block).toContain('Активный найм')
  })

  it('never invents a mode-specific claim — urgency only restates counts + freshness', () => {
    const block = formatBatchLeadBlock(
      lead({ hiringMode: 'executive', vacanciesCount: 1, latestPublishedAt: null }),
      1,
    )
    // No date and a single role → neutral cue, no fabricated seniority/timing.
    expect(block).not.toContain('руководителя')
    expect(block).not.toContain('C-level')
  })
})

describe('buildBatchDigestMessages', () => {
  it('returns no messages for an empty run', () => {
    const r = buildBatchDigestMessages({ leads: [], leadsUrl: LEADS_URL })
    expect(r.messages).toEqual([])
    expect(r.includedLeads).toBe(0)
  })

  it('batches multiple leads into ONE digest message with header and footer', () => {
    const leads = [
      lead({ orgId: '1' }),
      lead({ orgId: '2', orgName: 'Лютик' }),
      lead({ orgId: '3', orgName: 'Одуванчик' }),
    ]
    const r = buildBatchDigestMessages({ leads, leadsUrl: LEADS_URL })
    expect(r.messages).toHaveLength(1)
    expect(r.includedLeads).toBe(3)
    expect(r.messages[0]).toContain('Радар')
    expect(r.messages[0]).toContain('3 компании')
    expect(r.messages[0]).toContain('1.')
    expect(r.messages[0]).toContain('2.')
    expect(r.messages[0]).toContain('3.')
    expect(r.messages[0]).toContain('Открыть все лиды')
    expect(r.messages[0]).toContain(LEADS_URL)
  })

  it('keeps 5 and 10 leads within a single coherent digest', () => {
    for (const n of [5, 10]) {
      const leads = Array.from({ length: n }, (_, i) => lead({ orgId: String(i), orgName: `Co ${i}` }))
      const r = buildBatchDigestMessages({ leads, leadsUrl: LEADS_URL })
      expect(r.includedLeads).toBe(n)
      expect(r.messages.length).toBeGreaterThanOrEqual(1)
      expect(r.messages.length).toBeLessThanOrEqual(MAX_BATCH_MESSAGES)
    }
  })

  it('splits into at most MAX_BATCH_MESSAGES and respects the 4096 char limit', () => {
    const bulky = Array.from({ length: 60 }, (_, i) =>
      lead({
        orgId: String(i),
        orgName: `Компания с довольно длинным названием номер ${i}`,
        evidenceTitles: ['Разработчик серверной части', 'Инженер по инфраструктуре и надёжности'],
        whyLine: 'нанимают сразу по нескольким вашим ключевым направлениям подбора',
      }),
    )
    const r = buildBatchDigestMessages({ leads: bulky, leadsUrl: LEADS_URL })
    expect(r.messages.length).toBeLessThanOrEqual(MAX_BATCH_MESSAGES)
    for (const msg of r.messages) {
      expect(msg.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_CHAR_LIMIT)
    }
    // Some leads should be dropped from the text when they overflow the cap.
    expect(r.droppedLeads).toBeGreaterThan(0)
    expect(r.includedLeads + r.droppedLeads).toBe(60)
    // The footer link is on the last message only — the recruiter can still open all.
    expect(r.messages[r.messages.length - 1]).toContain('Открыть все лиды')
  })
})
