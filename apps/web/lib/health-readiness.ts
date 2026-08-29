export const EXPECTED_LATEST_MIGRATION =
  '20260829090000_add_source_refresh_evidence_capture'

const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/

export function readDeploySha(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const value = env.RR_DEPLOY_SHA?.trim().toLowerCase()
  return value && FULL_COMMIT_SHA.test(value) ? value : null
}

export function configurationReadiness(
  env: Readonly<Record<string, string | undefined>> = process.env,
): 'ready' | 'incomplete' {
  return readDeploySha(env) !== null
    && env.PUBLIC_APP_ORIGIN?.trim() === 'https://recruiter-radar.ru'
    ? 'ready'
    : 'incomplete'
}
