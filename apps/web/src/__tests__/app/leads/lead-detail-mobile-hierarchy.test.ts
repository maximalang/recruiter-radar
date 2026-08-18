import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const pagePath = resolve(process.cwd(), 'app', 'leads', '[id]', 'page.tsx')
const stylesPath = resolve(process.cwd(), 'app', 'leads', '[id]', 'lead-brief.module.css')

describe('company brief mobile hierarchy', () => {
  it('keeps Why now -> Evidence -> Confidence -> Next move -> Provenance before contextual actions and secondary context', async () => {
    const page = await readFile(pagePath, 'utf8')
    const orderedAnchors = [
      'data-company-brief-decision',
      'data-company-brief-evidence',
      'data-company-brief-confidence',
      'data-company-brief-next-move',
      'data-company-brief-provenance',
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
    expect(styles).toContain('"evidence action"')
    expect(styles).toContain('"confidence action"')
    expect(styles).toContain('"next action"')
    expect(styles).toContain('"provenance action"')
    expect(styles).toContain('"evidence"')
    expect(styles).toContain('"confidence"')
    expect(styles).toContain('"next"')
    expect(styles).toContain('"provenance"')
    expect(styles).not.toMatch(/(?:^|[;{])\s*order\s*:/)
  })

  it('keeps score subordinate and reuses canonical evidence, confidence, and provenance primitives', async () => {
    const page = await readFile(pagePath, 'utf8')

    expect(page).toContain('<EvidenceTimeline>')
    expect(page).toContain('<ConfidenceIndicator level={confidence.level}>')
    expect(page).toContain('<Provenance>')
    expect(page).toContain('Сила сигнала: {score}')
    expect(page).not.toContain('styles.scoreBlock')
    expect(page).not.toContain('styles.score}')
  })

  it('uses shared Russian count grammar and final user-facing terminology', async () => {
    const page = await readFile(pagePath, 'utf8')

    expect(page).toContain("formatVacanciesCount(lead.vacanciesCount)")
    expect(page).toContain("pluralForm(count, ['роль', 'роли', 'ролей'])")
    expect(page).toContain("pluralForm(count, ['источник', 'источника', 'источников'])")
    expect(page).toContain('<span className={styles.railTitle}>Статус</span>')
    expect(page).toContain('текущий сигнал найма')
    expect(page).not.toContain('текущий hiring signal')
    expect(page).not.toContain('<span className={styles.railTitle}>Workflow</span>')
    expect(page).not.toContain('{lead.vacanciesCount} вакансий')
    expect(page).not.toContain('{lead.sourceFamilies.length} источников')
  })
})
