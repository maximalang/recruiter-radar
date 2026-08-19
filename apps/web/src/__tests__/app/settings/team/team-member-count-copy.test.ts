import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('team member count copy', () => {
  it('uses Russian plural forms instead of a fixed participants label', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'app/settings/team/team-settings-view.tsx'),
      'utf8',
    )

    expect(source).toContain('pluralForm(props.team.members.length')
    expect(source).toContain('["участник", "участника", "участников"]')
    expect(source).not.toContain('<span>участников</span>')
  })
})
