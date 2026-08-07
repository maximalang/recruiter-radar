import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('Evidence Radar production surface contract', () => {
  const opportunitiesRoot = resolve(process.cwd(), 'app', 'opportunities')
  const intelligenceRoot = resolve(process.cwd(), 'lib', 'intelligence')
  const map = readFileSync(resolve(opportunitiesRoot, 'evidence-radar-map.tsx'), 'utf8')
  const radarPage = readFileSync(resolve(opportunitiesRoot, 'radar', 'page.tsx'), 'utf8')
  const sourcePage = readFileSync(resolve(opportunitiesRoot, 'sources', 'page.tsx'), 'utf8')
  const repository = readFileSync(resolve(intelligenceRoot, 'evidence-radar-repository.ts'), 'utf8')
  const navigation = readFileSync(resolve(opportunitiesRoot, 'navigation.ts'), 'utf8')

  it('never fabricates organization placement or signal density', () => {
    expect(map).not.toContain('Math.random')
    expect(map).toContain('projectRussianCoordinates')
    expect(map).toContain('deterministicOrbit')
    expect(map).toContain('independentSourceCount')
    expect(map).toContain('Нет лидов с подтверждённой географией')
  })

  it('renders source circles, organization diamonds and evidence details from real rows', () => {
    expect(map).toContain('sourceDot')
    expect(map).toContain('organizationDiamond')
    expect(map).toContain('lead.evidence.map')
    expect(map).toContain('canonicalUrl')
    expect(map).toContain('lead.score.contributions')
    expect(map).toContain('lead.contactPaths')
    expect(map).toContain('riskReasons')
  })

  it('keeps both routes behind Opportunity authorization and Commercial Signal feature gates', () => {
    for (const route of [radarPage, sourcePage]) {
      expect(route).toContain("getOpportunityAuthorizationContext('opportunities:read')")
      expect(route).toContain('isOpportunityEngineV1EnabledForContext')
      expect(route).toContain('isOpportunityCommercialSignalUiEnabledForContext')
      expect(route).not.toContain('demo=1')
    }
  })

  it('reads the radar strictly inside workspace scope and only with verified coordinates', () => {
    expect(repository).toContain('WHERE card.workspace_id = $1')
    expect(repository).toContain('location.latitude IS NOT NULL')
    expect(repository).toContain('location.longitude IS NOT NULL')
    expect(repository).toContain('evidence_events_v1')
    expect(repository).toContain('public_contact_paths_v1')
  })

  it('surfaces the map and source registry in Opportunity navigation without replacing Today', () => {
    expect(navigation).toContain("href: '/opportunities'")
    expect(navigation).toContain("href: '/opportunities/radar'")
    expect(navigation).toContain("href: '/opportunities/sources'")
  })

  it('makes source automation status explicit instead of inferring legal permission', () => {
    expect(sourcePage).toContain('canAutomateSource')
    expect(sourcePage).toContain('legalReviewStatus')
    expect(sourcePage).toContain('automationPolicy')
    expect(sourcePage).toContain('fail-closed')
  })
})
