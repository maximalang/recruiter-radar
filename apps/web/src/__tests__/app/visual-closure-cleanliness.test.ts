import fs from 'node:fs'
import path from 'node:path'

const WEB_ROOT = process.cwd()
const REPO_ROOT = path.resolve(WEB_ROOT, '../..')

function repoPath(...parts: string[]) {
  return path.join(REPO_ROOT, ...parts)
}

describe('V1–V6 visual closure cleanliness', () => {
  it('does not retain retired compatibility/HUD layers', () => {
    const retired = [
      repoPath('apps/web/app/ui/product-workspace-polish.module.css'),
      repoPath('apps/web/app/opportunities/opportunity-card.tsx'),
      repoPath('apps/web/app/dashboard/dashboard.module.css'),
      // Legacy raw-hex implementations stay retired; the restored signal field
      // lives under canonical token-based module names instead.
      repoPath('apps/web/app/landing/hero-radar.module.css'),
      repoPath('apps/web/app/landing/hero-radar.tsx'),
      repoPath('apps/web/app/landing/signal-timeline-scene.tsx'),
      repoPath('apps/web/app/landing/signal-timeline-scene.module.css'),
    ]

    for (const file of retired) {
      expect(fs.existsSync(file)).toBe(false)
    }
  })

  it('does not retain one-shot visual closure tooling', () => {
    const temporary = [
      repoPath('.github/visual-hover-closure.trigger'),
      repoPath('.github/visual-hover-closure-finalize.trigger'),
      repoPath('.github/workflows/visual-hover-closure.yml'),
      repoPath('.github/workflows/visual-hover-closure-finalize.yml'),
      repoPath('scripts/ci/close-hover-gates.mjs'),
    ]

    for (const file of temporary) {
      expect(fs.existsSync(file)).toBe(false)
    }
  })

  it('keeps permanent visual closure documentation in the repository', () => {
    expect(fs.existsSync(repoPath('docs/visual-system/V1-V6-CLOSURE.md'))).toBe(true)
    expect(fs.existsSync(repoPath('docs/visual-system/QA-MATRIX.md'))).toBe(true)
  })
})
