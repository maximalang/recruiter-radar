import fs from 'node:fs'
import path from 'node:path'

const APP_ROOT = path.resolve(process.cwd(), 'app')
const SOURCE_EXTENSIONS = new Set(['.css', '.ts', '.tsx'])

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(absolute)
    return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [absolute] : []
  })
}

function relative(file: string) {
  return path.relative(APP_ROOT, file).replaceAll(path.sep, '/')
}

describe('Recruiter Radar V1-V6 visual contract', () => {
  const files = sourceFiles(APP_ROOT)

  it('does not retain versioned visual systems or banned legacy visual grammar', () => {
    const banned = [
      { label: 'versioned visual selector', regex: /recruiter-radar-v(?:6|7)/gi },
      { label: 'legacy lime signal', regex: /#(?:9fca63|c8f36a|c9ec8b)\b/gi },
      { label: 'ScoreGauge', regex: /\bScoreGauge\b/g },
      { label: 'ScoreBar', regex: /\bScoreBar\b/g },
      { label: 'ScoreBandChip', regex: /\bScoreBandChip\b/g },
      { label: 'SettingsOverview', regex: /\bSettingsOverview\b/g },
      { label: 'Radar organizationDiamond', regex: /\borganizationDiamond\b/g },
      { label: 'Radar scoreGrid', regex: /\bscoreGrid\b/g },
      { label: 'old Dashboard label', regex: /Дашборд/g },
      { label: 'old Opportunities entity label', regex: /\bВозможности\b/g },
      { label: 'old Command Center label', regex: /Командный центр/g },
      { label: 'old Demand Map label', regex: /Карта спроса/g },
      { label: 'old confidence gate copy', regex: /уверенност(?:ь|ью)\s+[ABCD]\b/gi },
    ]
    const failures: string[] = []

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8')
      for (const rule of banned) {
        rule.regex.lastIndex = 0
        if (rule.regex.test(content)) failures.push(`${relative(file)}: ${rule.label}`)
      }
    }

    expect(failures).toEqual([])
  })

  it('rejects legacy --c-* and --rr-* token namespaces', () => {
    const failures: string[] = []

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8')
      for (const token of new Set(content.match(/--(?:c|rr)-[a-z0-9-]+/gi) ?? [])) {
        failures.push(`${relative(file)}: ${token}`)
      }
    }

    expect(failures).toEqual([])
  })

  it('does not create a landing-specific color or radius namespace', () => {
    const landingRoot = path.join(APP_ROOT, 'landing')
    const landingFiles = sourceFiles(landingRoot)
    const forbiddenAliases = /--(?:paper(?:-soft|-strong)?|ink|muted-(?:dark|light)|line-(?:dark|light)|signal(?:-strong|-deep|-soft)?|copper|warning|surface-radius)\s*:/gi
    const failures: string[] = []

    for (const file of landingFiles) {
      const content = fs.readFileSync(file, 'utf8')
      for (const alias of new Set(content.match(forbiddenAliases) ?? [])) {
        failures.push(`${relative(file)}: ${alias.replace(/\s*:$/, '')}`)
      }
    }

    expect(failures).toEqual([])
  })

  it('defines the required semantic foundation tokens', () => {
    const globals = fs.readFileSync(path.join(APP_ROOT, 'globals.css'), 'utf8')
    const required = [
      '--color-canvas',
      '--color-surface-primary',
      '--color-surface-secondary',
      '--color-surface-selected',
      '--color-surface-elevated',
      '--color-text-primary',
      '--color-text-secondary',
      '--color-text-tertiary',
      '--color-separator',
      '--color-signal',
      '--color-confidence-high',
      '--color-confidence-medium',
      '--color-confidence-low',
    ]

    for (const token of required) {
      expect(globals).toContain(`${token}:`)
    }
  })

  it('provides the core intelligence primitives without a universal Card primitive', () => {
    const primitives = fs.readFileSync(path.join(APP_ROOT, 'ui/intelligence-primitives.tsx'), 'utf8')
    const required = [
      'AppCanvas',
      'WorkspaceHeader',
      'Zone',
      'Separator',
      'DataRow',
      'LeadRow',
      'DecisionBrief',
      'EvidenceRow',
      'EvidenceTimeline',
      'Provenance',
      'MetadataLine',
      'SignalIndicator',
      'ConfidenceIndicator',
      'FilterBar',
      'SearchField',
      'ContextPane',
      'EmptyState',
      'LoadingState',
    ]

    for (const primitive of required) {
      expect(primitives).toMatch(new RegExp(`export function ${primitive}\\b`))
    }
    expect(primitives).not.toMatch(/export function (?:Card|UniversalCard)\b/)
  })
})
