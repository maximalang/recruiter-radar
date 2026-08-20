import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const stylesPath = resolve(process.cwd(), 'app', 'dashboard', 'dashboard-workspace.module.css')

describe('dashboard extreme-content visual contract', () => {
  it('keeps company identities readable in the latest-signal ledger', async () => {
    const styles = await readFile(stylesPath, 'utf8')

    expect(styles).toContain('.todayChangeRow strong{display:block;overflow-wrap:anywhere;')
    expect(styles).not.toContain('.todayChangeRow strong{display:block;overflow:hidden;')
    expect(styles).not.toMatch(/\.todayChangeRow strong\{[^}]*text-overflow:ellipsis/)
    expect(styles).not.toMatch(/\.todayChangeRow strong\{[^}]*white-space:nowrap/)
  })
})
