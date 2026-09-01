import { getCanonicalSourcePolicy, isDefaultGeneratorSource } from './source-policy'

/**
 * Delivery-impact criticality of a refreshable source.
 *
 * - `required`: the source can originate digest leads (directly or via
 *   confidence gating) or is the mandatory organization-identity enricher.
 *   A failed run changes what digests can deliver and how evidence/FIUR
 *   inputs are formed, so it must never be masked as green.
 * - `optional`: the source only enriches or adds context. Its absence
 *   degrades freshness but does not change digest/evidence/FIUR delivery.
 * - `unknown`: no canonical policy is registered for the id. Treated as
 *   required everywhere (fail-closed).
 */
export type SourceCriticality = 'required' | 'optional' | 'unknown'

export function getSourceCriticality(sourceId: string): SourceCriticality {
  const policy = getCanonicalSourcePolicy(sourceId)
  if (!policy) return 'unknown'
  // egrul-fns is the mandatory organization-identity enricher: even though it
  // never originates leads, its failure degrades identity resolution for every
  // downstream source (evidence/FIUR inputs), so it is delivery-impacting.
  if (sourceId === 'egrul-fns') return 'required'
  return isDefaultGeneratorSource(sourceId) ? 'required' : 'optional'
}

/**
 * Single effective-failure rule shared by route, workflow and tests.
 *
 * A refresh result counts as an effective failure when it explicitly failed
 * (`success === false`) OR when a required refresh window was missed due to
 * transport throttling (`outcome === 'rate-limited'` — the ingest reports it
 * with success:true, which must not hide the stale-input condition).
 * `deferred` is an expected scheduler-overlap state and never a failure.
 */
export function isEffectiveFailure(result: { success?: boolean; outcome?: string }): boolean {
  return result?.success === false || result?.outcome === 'rate-limited'
}

/**
 * True when at least one failed source has delivery impact. A 207 with only
 * optional failures stays a warning; any required/unknown failure must fail
 * the clock so degradation is visible in CI/alerting instead of silently
 * narrowing the digest.
 */
export function hasDeliveryImpactingFailure(
  failedSources: readonly { source?: string; outcome?: string }[],
): boolean {
  return failedSources.some((failure) => {
    // Deferred is an expected scheduler overlap state and is not a source
    // failure. Rate-limited is delivery-impacting for required/unknown sources
    // because their digest/evidence inputs missed the refresh window; optional
    // rate limits remain non-delivery-impacting.
    if (failure?.outcome === 'deferred') return false
    return getSourceCriticality(String(failure?.source ?? '')) !== 'optional'
  })
}
