import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('Evidence Radar V1-V6 production surface contract', () => {
  const opportunitiesRoot = resolve(process.cwd(), 'app', 'opportunities')
  const intelligenceRoot = resolve(process.cwd(), 'lib', 'intelligence')
  const map = readFileSync(resolve(opportunitiesRoot, 'evidence-radar-map.tsx'), 'utf8')
  const mapCss = readFileSync(resolve(opportunitiesRoot, 'evidence-radar-map.module.css'), 'utf8')
  const radarPage = readFileSync(resolve(opportunitiesRoot, 'radar', 'page.tsx'), 'utf8')
  const sourcePage = readFileSync(resolve(process.cwd(), 'app', 'settings', 'diagnostics', 'sources', 'page.tsx'), 'utf8')
  const legacySourcePage = readFileSync(resolve(opportunitiesRoot, 'sources', 'page.tsx'), 'utf8')
  const repository = readFileSync(resolve(intelligenceRoot, 'evidence-radar-repository.ts'), 'utf8')
  const governance = readFileSync(resolve(intelligenceRoot, 'evidence-source-governance-repository.ts'), 'utf8')
  const navigation = readFileSync(resolve(opportunitiesRoot, 'navigation.ts'), 'utf8')

  it('positions companies by recency and evidence confidence, never by decorative geography', () => {
    expect(map).not.toContain('Math.random')
    expect(map).not.toContain('projectRussianCoordinates')
    expect(map).not.toContain('geometryPaths')
    expect(map).not.toContain('organizationDiamond')
    expect(map).not.toContain('deterministicOrbit')
    expect(map).toContain('latestEvidenceTimestamp')
    expect(map).toContain('confidenceScore')
    expect(map).toContain('RADAR_WINDOW_DAYS')
    expect(map).toContain('Свежесть × уровень подтверждения')
    expect(map).toContain('Подтверждённых сигналов пока нет')
  })

  it('renders evidence relationships only from real evidence rows and keeps recruiter detail truth', () => {
    expect(map).toContain('lead.evidence.slice(0, 3)')
    expect(map).toContain('data-evidence-source')
    expect(map).toContain('lead.evidence.map')
    expect(map).toContain('canonicalUrl')
    expect(map).toContain('lead.score.contributions')
    expect(map).toContain('lead.contactPaths')
    expect(map).toContain('riskReasons')
    expect(map).not.toContain('Array.from({ length: sourceCount')
  })

  it('keeps selection operable for pointer, keyboard, touch and reduced motion', () => {
    expect(map).toContain('semanticList')
    expect(map).toContain('aria-pressed={props.selected}')
    expect(mapCss).toMatch(/\.organizationMarker\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/)
    expect(mapCss).toContain('.organizationMarker:focus-visible')
    expect(mapCss).toContain('.organizationMarker:hover')
    expect(mapCss).toContain('@keyframes selectedSignal')
    expect(mapCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(mapCss).toContain('animation: none')
  })

  it('keeps verified geography as metadata rather than primary Radar geometry', () => {
    expect(radarPage).not.toContain('listEvidenceRadarRegionBoundaries')
    expect(radarPage).not.toContain('boundaries={boundaries}')
    expect(radarPage).toContain('География остаётся контекстом')
    expect(map).toContain('lead.location.city')
    expect(map).not.toContain('data-region-code')
  })

  it('keeps both Evidence Radar routes behind authorization and the dedicated rollout gate', () => {
    for (const route of [radarPage, sourcePage]) {
      expect(route).toContain("getOpportunityAuthorizationContext('opportunities:read')")
      expect(route).toContain('isOpportunityEngineV1EnabledForContext')
      expect(route).toContain('isEvidenceRadarV1EnabledForContext')
      expect(route).not.toContain('demo=1')
    }
  })

  it('reads Radar evidence strictly inside workspace scope', () => {
    expect(repository).toContain('WHERE card.workspace_id = $1')
    expect(repository).toContain('evidence_events_v1')
    expect(repository).toContain('public_contact_paths_v1')
  })

  it('keeps Sources outside primary product navigation and labels it as diagnostics', () => {
    expect(navigation).toContain("buildAccountNavigation('opportunities')")
    expect(navigation).not.toContain("label: 'Возможности'")
    expect(navigation).not.toContain('Диагностика источников')
    expect(legacySourcePage).toContain("redirect('/settings/diagnostics/sources')")
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
