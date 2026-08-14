/**
 * Company-controlled hiring surfaces.
 *
 * Hosted ATS boards are enrolled only after the career-page crawler discovers
 * them from a company's own domain. Their signals therefore keep the same
 * direct-hiring semantics as a same-domain career page while retaining the
 * real provider source id for provenance and source-level operations.
 */
export const COMPANY_HIRING_SOURCE_IDS = [
  'career-pages',
  'greenhouse',
  'lever',
  'ashby',
  'recruitee',
  'workable',
  'smartrecruiters',
] as const

const COMPANY_HIRING_SOURCE_ID_SET = new Set<string>(COMPANY_HIRING_SOURCE_IDS)

export function hasCompanyHiringSource(sourceFamilies: readonly string[]): boolean {
  return sourceFamilies.some((source) => COMPANY_HIRING_SOURCE_ID_SET.has(source))
}
