/**
 * Contact-quality scorer.
 *
 * Pure helper that turns a list of categorized ContactPath items into a
 * 0..1 quality score plus tier, diversity count, HR-channel flag, and
 * reasons. Feeds Reachability in FIUR and the Contact Quality bullet of
 * the agency lead-scoring rubric.
 *
 * Rewards:
 *   - presence of a hiring-purpose channel (hr-email or careers-email)
 *   - distinct channel categories (email + phone + messenger > 3 emails)
 *   - safe non-personal routes (generic mailbox or contact form)
 *
 * Penalizes:
 *   - personal-email-only (privacy risk, weaker outreach)
 */

import type { ContactCategory, ContactPath } from './contact-paths'

export type ContactQualityTier = 'none' | 'weak' | 'ok' | 'rich'

export interface ContactQualityResult {
  score: number
  tier: ContactQualityTier
  diversity: number
  hasHrChannel: boolean
  reasons: string[]
}

const HR_CATEGORIES = new Set<ContactCategory>(['hr-email', 'careers-email'])
const PROFESSIONAL_CATEGORIES = new Set<ContactCategory>([
  'hr-email',
  'careers-email',
  'generic-email',
  'phone',
  'contact-form',
  'telegram',
  'whatsapp',
])

function clamp01(n: number): number {
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function classifyTier(score: number): ContactQualityTier {
  if (score === 0) return 'none'
  if (score < 0.4) return 'weak'
  if (score < 0.75) return 'ok'
  return 'rich'
}

export function computeContactQuality(paths: ContactPath[]): ContactQualityResult {
  if (paths.length === 0) {
    return {
      score: 0,
      tier: 'none',
      diversity: 0,
      hasHrChannel: false,
      reasons: [],
    }
  }

  const categories = new Set<ContactCategory>(paths.map((p) => p.category))
  const diversity = categories.size
  const hasHrChannel = paths.some((p) => HR_CATEGORIES.has(p.category))
  const hasProfessional = paths.some((p) => PROFESSIONAL_CATEGORIES.has(p.category))
  const personalOnly = paths.every((p) => p.category === 'personal-email')

  let score = 0
  const reasons: string[] = []

  if (hasHrChannel) {
    score += 0.5
    reasons.push('HR or careers contact path available')
  } else if (hasProfessional) {
    score += 0.2
    reasons.push('non-personal contact channel available')
  }

  const diversityBonus = Math.min(0.3, Math.max(0, diversity - 1) * 0.1)
  if (diversityBonus > 0) {
    score += diversityBonus
    reasons.push(`${diversity} independent channel categories`)
  }

  if (personalOnly) {
    score = Math.max(0, score - 0.1) + 0.05
    reasons.push('personal-email only — privacy risk and weaker outreach')
  }

  const richBonus = hasHrChannel && diversity >= 3 ? 0.15 : 0
  if (richBonus > 0) score += richBonus

  const finalScore = clamp01(score)
  return {
    score: finalScore,
    tier: classifyTier(finalScore),
    diversity,
    hasHrChannel,
    reasons,
  }
}
