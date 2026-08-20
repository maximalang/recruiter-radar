import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('settings document interaction contract', () => {
  it('keeps standalone settings links at 44px minimum height', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'app/settings/settings-document-summary.module.css'),
      'utf8',
    )

    expect(styles).toContain('.settingsNav a{min-height:44px;')
    expect(styles).toContain('.action{min-height:44px;')
    expect(styles).toContain('.inlineLinks a{min-height:44px;')
    expect(styles).not.toContain('min-height:40px')
  })
})
