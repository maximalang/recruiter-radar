import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const pagePath = resolve(process.cwd(), 'app', 'leads', '[id]', 'page.tsx')
const stylesPath = resolve(process.cwd(), 'app', 'leads', '[id]', 'lead-brief.module.css')

describe('company brief mobile hierarchy', () => {
  it('keeps Decision -> Evidence -> Action before secondary context in DOM order', async () => {
    const page = await readFile(pagePath, 'utf8')
    const orderedAnchors = [
      'data-company-brief-decision',
      'data-company-brief-evidence',
      'data-company-brief-action',
      'data-company-brief-context',
    ]

    let previous = -1
    for (const anchor of orderedAnchors) {
      const current = page.indexOf(anchor)
      expect(current).toBeGreaterThan(previous)
      previous = current
    }
    expect(page.match(/<NextStepsBlock/g)).toHaveLength(1)
  })

  it('uses semantic grid areas rather than CSS order to preserve mobile meaning', async () => {
    const styles = await readFile(stylesPath, 'utf8')
    expect(styles).toContain('grid-template-areas:"evidence action" "main action"')
    expect(styles).toContain('grid-template-areas:"evidence" "action" "main"')
    expect(styles).not.toMatch(/(?:^|[;{])\s*order\s*:/)
  })
})
