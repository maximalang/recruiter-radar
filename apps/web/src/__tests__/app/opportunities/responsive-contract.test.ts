import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('opportunities responsive contract', () => {
  it('collapses cards, brief fields, and actions for narrow screens', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'app/opportunities/opportunities.module.css'),
      'utf8',
    )
    expect(css).toContain('@media (max-width: 680px)')
    expect(css).toMatch(/\.cardHeader\s*\{[\s\S]*?grid-template-columns:\s*1fr/)
    expect(css).toMatch(/\.briefGrid\s*\{[\s\S]*?grid-template-columns:\s*1fr/)
    expect(css).toContain('.actionButtons,')
    expect(css).toContain('width: 100%')
  })
})
