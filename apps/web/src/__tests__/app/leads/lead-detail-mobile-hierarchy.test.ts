import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const pagePath = resolve(process.cwd(), 'app', 'leads', '[id]', 'page.tsx')

describe('lead detail mobile hierarchy', () => {
  it('keeps decision, contact and action before secondary context in DOM order', async () => {
    const page = await readFile(pagePath, 'utf8')
    const orderedAnchors = [
      '<section className={styles.decision}',
      '<aside className={styles.aside}',
      '<span className={styles.railTitle}>Контакт</span>',
      '<NextStepsBlock',
      '<div className={styles.main}>',
      '<h2>Контекст компании и найма</h2>',
      '<h2>Evidence ledger</h2>',
    ]

    let previous = -1
    for (const anchor of orderedAnchors) {
      const current = page.indexOf(anchor)
      expect(current).toBeGreaterThan(previous)
      previous = current
    }
    expect(page.match(/<NextStepsBlock/g)).toHaveLength(1)
  })
})
