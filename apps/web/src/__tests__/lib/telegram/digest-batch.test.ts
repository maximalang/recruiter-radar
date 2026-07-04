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
    vacanciesCount: 4,
    evidenceTitles: ['Backend разработчик', 'DevOps инженер'],
    locationNames: ['Москва'],
    whyLine: 'нанимают по вашему профилю',
    isForeignEmployer: false,
    ...overrides,
  }
}

const LEADS_URL = 'https://app.example.com/leads'

describe('formatBatchLeadBlock', () => {
  it('renders a numbered block with company, roles, and why line', () => {
    const block = formatBatchLeadBlock(lead(), 1)
    expect(block).toContain('1.')
    expect(block).toContain('<b>Ромашка</b>')
    expect(block).toContain('Москва')
    expect(block).toContain('Роли:')
    expect(block).toContain('Backend разработчик')
    expect(block).toContain('нанимают по вашему профилю')
  })

  it('marks a foreign employer with 🌍', () => {
    expect(formatBatchLeadBlock(lead({ isForeignEmployer: true }), 2)).toContain('🌍')
    expect(formatBatchLeadBlock(lead({ isForeignEmployer: false }), 2)).not.toContain('🌍')
  })

  it('shows "не определены" when there are no roles', () => {
    expect(formatBatchLeadBlock(lead({ evidenceTitles: [] }), 1)).toContain('Роли: не определены')
  })

  it('escapes HTML in the company name', () => {
    const block = formatBatchLeadBlock(lead({ orgName: 'A & B <Co>' }), 1)
    expect(block).toContain('A &amp; B &lt;Co&gt;')
  })
})

describe('buildBatchDigestMessages', () => {
  it('returns no messages for an empty run', () => {
    const r = buildBatchDigestMessages({ leads: [], leadsUrl: LEADS_URL })
    expect(r.messages).toEqual([])
    expect(r.includedLeads).toBe(0)
  })

  it('builds a single message for 3 leads with header and footer link', () => {
    const leads = [lead({ orgId: '1' }), lead({ orgId: '2', orgName: 'Лютик' }), lead({ orgId: '3', orgName: 'Одуванчик' })]
    const r = buildBatchDigestMessages({ leads, leadsUrl: LEADS_URL })
    expect(r.messages).toHaveLength(1)
    expect(r.includedLeads).toBe(3)
    expect(r.messages[0]).toContain('Радар на')
    expect(r.messages[0]).toContain('3 компании')
    expect(r.messages[0]).toContain('1.')
    expect(r.messages[0]).toContain('2.')
    expect(r.messages[0]).toContain('3.')
    expect(r.messages[0]).toContain('Открыть все лиды')
    expect(r.messages[0]).toContain(LEADS_URL)
  })

  it('handles 5 and 10 leads within a single message', () => {
    for (const n of [5, 10]) {
      const leads = Array.from({ length: n }, (_, i) => lead({ orgId: String(i), orgName: `Co ${i}` }))
      const r = buildBatchDigestMessages({ leads, leadsUrl: LEADS_URL })
      expect(r.includedLeads).toBe(n)
      expect(r.messages.length).toBeGreaterThanOrEqual(1)
      expect(r.messages.length).toBeLessThanOrEqual(MAX_BATCH_MESSAGES)
    }
  })

  it('splits into at most 2 messages and respects the 4096 char limit', () => {
    // Long role lists inflate each block so the batch must split.
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
    // Some leads should be dropped from the text when they overflow 2 messages.
    expect(r.droppedLeads).toBeGreaterThan(0)
    expect(r.includedLeads + r.droppedLeads).toBe(60)
    // The footer link is on the last message only.
    expect(r.messages[r.messages.length - 1]).toContain('Открыть все лиды')
  })
})
