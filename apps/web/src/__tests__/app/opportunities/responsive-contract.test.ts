import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('opportunities responsive contract', () => {
  it('collapses cards and keeps interactive targets usable on narrow screens', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'app/opportunities/opportunities.module.css'),
      'utf8',
    )
    expect(css).toContain('@media (max-width: 680px)')
    expect(css).toMatch(/\.cardHeader\s*\{[\s\S]*?grid-template-columns:\s*1fr/)
    expect(css).toMatch(/\.decisionGrid\s*\{[\s\S]*?grid-template-columns:\s*1fr/)
    expect(css).toMatch(
      /\.decisionContext\s*\{[^}]*grid-template-columns:\s*repeat\(3,/,
    )
    expect(css).toContain('.actionButtons,')
    expect(css).toContain('width: 100%')
    for (const selector of [
      '\\.headerLink',
      '\\.filterLink',
      '\\.timelineItem a',
      '\\.actionButton',
    ]) {
      expect(css).toMatch(new RegExp(`${selector}\\s*\\{[^}]*min-height:\\s*44px`))
    }
  })
})
