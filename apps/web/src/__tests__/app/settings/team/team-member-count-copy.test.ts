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

  it('keeps long pending-invite email identities inside the responsive ledger', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'app/settings/team/team-settings.module.css'),
      'utf8',
    ).replace(/\r\n/g, '\n')

    expect(styles).toContain('.inviteList > li > div {\n  min-width: 0;\n}')
    expect(styles).toContain('.inviteList strong,\n.inviteList p {\n  overflow-wrap: anywhere;\n}')
  })
})
