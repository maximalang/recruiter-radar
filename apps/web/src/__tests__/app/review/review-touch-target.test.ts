import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('review workspace interaction contract', () => {
  it('keeps the primary row action at a 44px standalone target', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'app/review/review.module.css'),
      'utf8',
    )

    expect(styles).toContain('.actions>a{min-height:44px;')
    expect(styles).not.toContain('.actions>a{min-height:40px;')
  })

  it('surfaces the strongest evidence and keeps destructive styling interaction-bound', () => {
    const page = readFileSync(
      resolve(process.cwd(), 'app/review/page.tsx'),
      'utf8',
    )
    const actions = readFileSync(
      resolve(process.cwd(), 'app/review/review-actions.module.css'),
      'utf8',
    )

    expect(page).toContain('data-review-evidence-title')
    expect(page).toContain('candidate.evidenceTitles[0]')
    expect(page).toContain('listPendingReviewCandidates')
    expect(page).not.toContain('fetch(url.toString()')
    expect(actions).not.toContain('.btn[data-tone="danger"] {')
    expect(actions).toContain('.btn[data-tone="danger"]:hover')
    expect(actions).toContain('.verdict[data-tone="danger"]')
  })
})
