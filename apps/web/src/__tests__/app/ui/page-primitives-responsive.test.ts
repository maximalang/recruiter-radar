import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('shared summary row responsive contract', () => {
  it('lets long legal and account values shrink and stacks them on narrow screens', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'app/ui/page-primitives.module.css'),
      'utf8',
    )

    expect(css).toContain('.summaryRow{display:grid;grid-template-columns:minmax(0,1fr) auto')
    expect(css).toContain('.summaryValue{min-width:0;overflow-wrap:anywhere')
    expect(css).toContain('@media(max-width:520px){.summaryRow{grid-template-columns:minmax(0,1fr);gap:4px}')
  })
})
