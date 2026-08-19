import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('login brand contrast contract', () => {
  it('does not force the canvas-colored dark wordmark onto the auth story canvas', () => {
    const shell = readFileSync(
      resolve(process.cwd(), 'app/login/auth-shell.tsx'),
      'utf8',
    )

    expect(shell).toContain('<BrandLogo size="small" />')
    expect(shell).not.toContain('<BrandLogo size="small" tone="dark" />')
  })
})
