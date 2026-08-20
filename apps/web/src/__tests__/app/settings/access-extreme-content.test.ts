import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('access ledger extreme-content visual contract', () => {
  it('keeps entitlement values and long order identifiers inside narrow layouts', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'app/settings/access/access-ledger.module.css'),
      'utf8',
    )

    expect(styles).toMatch(/\.ledger dd\s*\{[^}]*min-width:\s*0[^}]*overflow-wrap:\s*anywhere/)
    expect(styles).toMatch(/\.orderIdentity\s*\{[^}]*min-width:\s*0/)
    expect(styles).toMatch(/\.orderIdentity strong,[\s\S]*?\.orderMeta\s*\{[^}]*overflow-wrap:\s*anywhere/)
    expect(styles).toMatch(/\.order\s*\{[^}]*min-width:\s*0/)
  })
})
