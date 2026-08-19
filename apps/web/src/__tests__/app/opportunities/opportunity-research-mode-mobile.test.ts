import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('Situation research mode mobile hierarchy', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'app/opportunities/opportunity-research-mode.tsx'),
    'utf8',
  )
  const styles = readFileSync(
    resolve(process.cwd(), 'app/opportunities/opportunity-research-mode.module.css'),
    'utf8',
  )

  it('collapses secondary research controls behind a native disclosure on narrow screens', () => {
    expect(source).toContain('<details')
    expect(source).toContain('className={disclosureStyles.mobileDisclosure}')
    expect(source).toContain('<span>Поиск и фильтры</span>')
    expect(source).toContain('<small>{viewLabel(props.view)}</small>')
    expect(styles).toContain('@media (max-width: 680px)')
    expect(styles).toMatch(/\.desktopControls\s*\{[^}]*display:\s*none/)
    expect(styles).toMatch(/\.mobileDisclosure\s*\{[^}]*display:\s*block/)
    expect(styles).toMatch(/\.mobileDisclosure > summary\s*\{[^}]*min-height:\s*48px/)
  })

  it('opens the disclosure when explicit search criteria need to stay visible', () => {
    expect(source).toContain('const disclosureOpen = Boolean(props.query || props.confidenceGate)')
    expect(source).toContain('open={disclosureOpen || undefined}')
  })

  it('renders the funnel only once outside duplicated responsive controls', () => {
    expect(source.match(/\{props\.children\}/g)).toHaveLength(1)
    expect(source.match(/<ResearchControls \{\.\.\.props\} \/>/g)).toHaveLength(2)
  })
})
