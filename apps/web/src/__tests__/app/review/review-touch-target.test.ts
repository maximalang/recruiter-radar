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
})
