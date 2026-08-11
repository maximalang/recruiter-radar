import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('Evidence Radar production surface contract', () => {
  const opportunitiesRoot = resolve(process.cwd(), 'app', 'opportunities')
  const intelligenceRoot = resolve(process.cwd(), 'lib', 'intelligence')
  const map = readFileSync(resolve(opportunitiesRoot, 'evidence-radar-map.tsx'), 'utf8')
  const mapCss = readFileSync(resolve(opportunitiesRoot, 'evidence-radar-map.module.css'), 'utf8')
  const radarPage = readFileSync(resolve(opportunitiesRoot, 'radar', 'page.tsx'), 'utf8')
  const sourcePage = readFileSync(resolve(opportunitiesRoot, 'sources', 'page.tsx'), 'utf8')
  const repository = readFileSync(resolve(intelligenceRoot, 'evidence-radar-repository.ts'), 'utf8')
  const boundaries = readFileSync(resolve(intelligenceRoot, 'evidence-radar-boundaries.ts'), 'utf8')
  const governance = readFileSync(resolve(intelligenceRoot, 'evidence-source-governance-repository.ts'), 'utf8')
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

  it('keeps selection operable across pointer, keyboard, touch and reduced motion', () => {
    expect(map).toContain('data-motion-interactive')
    expect(map).toContain('data-motion-disclosure')
    expect(map).toContain('data-evidence-source')
    expect(map).toContain("'--source-index'")
    expect(mapCss).toMatch(/\.organizationMarker\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/)
    expect(mapCss).toContain('.organizationMarker:focus-visible')
    expect(mapCss).toContain('.organizationMarker:hover')
    expect(mapCss).toContain('@keyframes evidenceSourceReveal')
    expect(mapCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(mapCss).toContain('animation: none')
  })

  it('renders administrative boundaries only from verified persisted GeoJSON', () => {
    expect(radarPage).toContain('listEvidenceRadarRegionBoundaries')
    expect(radarPage).toContain('boundaries={boundaries}')
    expect(boundaries).toContain("WHERE verification_status = 'verified'")
    expect(boundaries).toContain('geometry_geojson AS geometry')
    expect(map).toContain('geometryPaths')
    expect(map).toContain("type === 'Polygon'")
    expect(map).toContain("type === 'MultiPolygon'")
    expect(map).toContain('Границы субъектов ещё не загружены из верифицированного источника')
  })

  it('keeps both Evidence Radar routes behind authorization and the dedicated dark rollout gate', () => {
    for (const route of [radarPage, sourcePage]) {
      expect(route).toContain("getOpportunityAuthorizationContext('opportunities:read')")
      expect(route).toContain('isOpportunityEngineV1EnabledForContext')
      expect(route).toContain('isEvidenceRadarV1EnabledForContext')
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

  it('reads source automation state from the live append-only review ledger', () => {
    expect(sourcePage).toContain('listEvidenceSourceGovernance')
    expect(sourcePage).toContain('source.operational.reviewStatus')
    expect(sourcePage).toContain('source.operational.automationAllowed')
    expect(sourcePage).toContain('fail-closed')
    expect(governance).toContain('source_registry_reviews_v1')
    expect(governance).toContain('evidence_radar_source_allowed_v1(source.id)')
    expect(governance).toContain('ORDER BY item.reviewed_at DESC, item.id DESC')
  })
})
