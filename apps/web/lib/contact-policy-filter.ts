/**
 * Contact path filtering by client contact policy.
 *
 * Per product concept §Lawful contact path:
 * - corporate_only (default): only corporate/HR/career-page/form channels
 * - no_personal: exclude personal-email, phone, telegram, whatsapp
 * - unrestricted: all paths allowed
 *
 * This is the compliance-by-design layer: contact paths that don't
 * match the client's policy are filtered out before delivery.
 */

export type ContactPolicy = 'corporate_only' | 'no_personal' | 'unrestricted'

/** Minimal contact path shape — compatible with ContactPath from scoring/contact-paths */
export interface ContactPathLike {
  category: string
  value: string
  confidence?: string
}

/** Categories considered corporate/safe for all policies */
const CORPORATE_CATEGORIES = new Set([
  'careers-email',
  'hr-email',
  'generic-email',
  'contact-form',
])

/** True if any path is a non-personal corporate surface (career page, HR/generic email, form). */
export function hasCorporateSurface(paths: ContactPathLike[]): boolean {
  return paths.some((p) => CORPORATE_CATEGORIES.has(p.category))
}

/** Categories blocked by no_personal (and corporate_only) */
const PERSONAL_CATEGORIES = new Set([
  'personal-email',
  'phone',
  'telegram',
  'whatsapp',
])

/**
 * Filter contact paths based on the client's contact policy.
 * Returns only the paths allowed by the policy.
 */
export function filterContactPathsByPolicy<T extends ContactPathLike>(
  paths: T[],
  policy: ContactPolicy,
): T[] {
  if (policy === 'unrestricted') {
    return paths
  }

  if (policy === 'corporate_only') {
    // Only corporate/HR/form channels
    return paths.filter(p => CORPORATE_CATEGORIES.has(p.category))
  }

  // no_personal: exclude personal channels, keep corporate + generic-email
  return paths.filter(p => !PERSONAL_CATEGORIES.has(p.category))
}
