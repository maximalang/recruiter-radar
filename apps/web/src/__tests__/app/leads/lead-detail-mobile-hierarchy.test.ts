import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const pagePath = resolve(
  process.cwd(),
  'app',
  'leads',
  '[id]',
  'page.tsx',
)

describe('lead detail mobile hierarchy', () => {
  it('keeps the decision and action layer before secondary context', async () => {
    const page = await readFile(pagePath, 'utf8')
    const orderedAnchors = [
      '<ScoreGauge',
      '<ContentCardTitle>Почему сейчас</ContentCardTitle>',
      '<ContentCardTitle>Безопасный путь контакта</ContentCardTitle>',
      '<ContentCardTitle>Найденные контакты</ContentCardTitle>',
      '<NextStepsBlock',
      '<ContentCardTitle>Почему этот лид вам подходит</ContentCardTitle>',
      '<ContentCardTitle>Кратко о компании и найме</ContentCardTitle>',
      '<ContentCardTitle>Доказательства</ContentCardTitle>',
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
