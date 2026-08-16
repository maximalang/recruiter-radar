import fs from 'node:fs'
import path from 'node:path'

const APP_ROOT = path.resolve(process.cwd(), 'app')
const SOURCE_EXTENSIONS = new Set(['.css', '.ts', '.tsx'])
const ALLOWED_RR_TOKEN_PREFIXES = [
  '--rr-color-',
  '--rr-font-',
  '--rr-type-',
  '--rr-space-',
  '--rr-radius-',
  '--rr-shadow-',
  '--rr-motion-',
]

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
      { label: 'old Command Center label', regex: /Командный центр/g },
      { label: 'old Demand Map label', regex: /Карта спроса/g },
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

  it('uses only the final semantic Recruiter Radar token namespaces', () => {
    const failures: string[] = []

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8')
      const legacyCTokens = content.match(/--c-[a-z0-9-]+/gi) ?? []
      for (const token of new Set(legacyCTokens)) {
        failures.push(`${relative(file)}: ${token}`)
      }

      const rrTokens = content.match(/--rr-[a-z0-9-]+/gi) ?? []
      for (const token of new Set(rrTokens)) {
        if (ALLOWED_RR_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix))) continue
        failures.push(`${relative(file)}: ${token}`)
      }
    }

    expect(failures).toEqual([])
  })
})
