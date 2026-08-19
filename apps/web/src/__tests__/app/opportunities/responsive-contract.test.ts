import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('opportunities responsive contract', () => {
  it('collapses the decision workspace and keeps interactive targets usable on narrow screens', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'app/opportunities/opportunities.module.css'),
      'utf8',
    )
    expect(css).toContain('@media (max-width: 680px)')
    expect(css).not.toContain('.cardHeader')
    expect(css).toMatch(/\.researchForm\s*\{[\s\S]*?grid-template-columns:\s*1fr/)
    expect(css).toMatch(/\.decisionGrid\s*\{[\s\S]*?grid-template-columns:\s*1fr/)
    expect(css).toMatch(/\.workflowSummary,\s*\.workflowForm\s*\{[\s\S]*?grid-template-columns:\s*1fr/)
    expect(css).toContain('.actionButtons,')
    expect(css).toContain('width: 100%')
    for (const selector of [
      '\\.headerLink',
      '\\.filterLink',
      '\\.timelineItem a',
      '\\.actionButton',
    ]) {
      expect(css).toMatch(new RegExp(`${selector}[^\\{]*\\{[^}]*min-height:\\s*44px`))
    }
  })

  it('keeps situation state counts as compact operational metadata instead of KPI tiles', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'app/opportunities/situations-page.module.css'),
      'utf8',
    )
    expect(css).toMatch(/\.summaryLedger\s*\{[\s\S]*?display:\s*flex/)
    expect(css).toMatch(/\.summaryLedger > div\s*\{[\s\S]*?display:\s*inline-flex/)
    expect(css).toMatch(/\.summaryLedger strong\s*\{[\s\S]*?font-size:\s*var\(--type-data-size\)/)
    expect(css).not.toContain('grid-template-columns: repeat(4, minmax(0, 1fr))')
    expect(css).not.toMatch(/\.summaryLedger > div\s*\{[\s\S]*?border-right:/)
  })
})
