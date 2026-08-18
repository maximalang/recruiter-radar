import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const stylesPath = resolve(process.cwd(), 'app', 'leads', 'leads-workspace.module.css')

describe('leads workspace mobile hierarchy', () => {
  it('places decision context before confidence/action and demotes score to secondary data', async () => {
    const styles = await readFile(stylesPath, 'utf8')

    expect(styles).toContain(
      'grid-template-areas:"identity rank" "decision decision" "fresh fresh" "confidence confidence" "action action" "evidence evidence" "score score" "workflow workflow"',
    )
    expect(styles).toContain('.decision{display:contents}')
    expect(styles).toContain('.decision strong{grid-area:decision')
    expect(styles).toContain('.decisionMeta{grid-area:fresh')
    expect(styles).toContain('.confidence{grid-area:confidence')
    expect(styles).toContain('.action{grid-area:action')
    expect(styles).toContain('.evidence{grid-area:evidence')
    expect(styles).toContain('.score{grid-area:score')
    expect(styles).not.toMatch(/(?:^|[;{])\s*order\s*:/)
  })

  it('keeps the primary lead action at an accessible touch target', async () => {
    const styles = await readFile(stylesPath, 'utf8')
    expect(styles).toContain('.action{justify-self:end;min-height:44px')
  })
})
