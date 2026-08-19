import { getSourceConfig, type SourceId } from './source-registry'

export type SourceActivationState = 'configured' | 'credential-gated' | 'unavailable'

export interface SourceActivationMode {
  id: string
  /** Every variable in this set must be present for the mode to be runnable. */
  allOf: readonly string[]
}

export interface SourceActivationResult {
  state: SourceActivationState
  mode: string | null
  acceptedModes: readonly SourceActivationMode[]
  missingByMode: Readonly<Record<string, readonly string[]>>
}

/** Sources that must never become runnable from credentials alone. */
const POLICY_UNAVAILABLE_SOURCES = new Set<SourceId>([
  'telegram-company-channels',
])

/**
 * Runtime activation is mode-based rather than a flat list of env vars.
 * A source may have multiple accepted configurations (for example an input
 * file OR an approved provider). The scheduler must only execute a source when
 * at least one complete mode is configured; a partial mode is credential-gated.
 *
 * Sources omitted here inherit SourceConfig.requiredEnvVars as one legacy mode.
 * An empty inherited set is public/config-free and therefore configured.
 */
const SOURCE_ACTIVATION_MODES: Partial<Record<SourceId, readonly SourceActivationMode[]>> = {
  hh: [
    {
      id: 'application-token',
      allOf: ['HH_USER_AGENT', 'HH_ACCESS_TOKEN'],
    },
    {
      id: 'application-oauth-bootstrap',
      allOf: ['HH_USER_AGENT', 'HH_CLIENT_ID', 'HH_CLIENT_SECRET'],
    },
  ],
  superjob: [
    { id: 'official-api', allOf: ['SUPERJOB_API_APP_ID'] },
    { id: 'reviewed-file', allOf: ['SUPERJOB_INPUT_FILE'] },
  ],
  'habr-career': [
    { id: 'reviewed-file', allOf: ['HABR_CAREER_INPUT_FILE'] },
    {
      id: 'approved-provider',
      allOf: ['HABR_CAREER_PROVIDER_API_URL', 'HABR_CAREER_PROVIDER_API_TOKEN'],
    },
  ],
  'linkedin-company-pages': [
    { id: 'reviewed-file', allOf: ['LINKEDIN_COMPANY_PAGES_INPUT_FILE'] },
    {
      id: 'approved-provider',
      allOf: ['LINKEDIN_PROVIDER_API_URL', 'LINKEDIN_PROVIDER_API_TOKEN'],
    },
  ],
  'egrul-fns': [
    { id: 'reviewed-file', allOf: ['EGRUL_FNS_INPUT_FILE'] },
  ],
  'transparent-business-fns': [
    { id: 'official-fns-open-data-snapshot', allOf: ['SOURCE_SNAPSHOT_ROOT'] },
    { id: 'reviewed-file', allOf: ['TRANSPARENT_BUSINESS_FNS_INPUT_FILE'] },
    {
      id: 'approved-provider',
      allOf: ['TRANSPARENT_BUSINESS_FNS_PROVIDER_API_URL', 'TRANSPARENT_BUSINESS_FNS_PROVIDER_API_TOKEN'],
    },
  ],
  fedresurs: [
    { id: 'reviewed-file', allOf: ['FEDRESURS_INPUT_FILE'] },
    {
      id: 'approved-provider',
      allOf: ['FEDRESURS_PROVIDER_API_URL', 'FEDRESURS_PROVIDER_API_TOKEN'],
    },
  ],
  'youtube-company-channels': [
    { id: 'youtube-data-api-v3', allOf: ['YOUTUBE_API_KEY'] },
  ],
  'telegram-company-channels': [
    {
      id: 'authorized-mtproto',
      allOf: ['TELEGRAM_API_ID', 'TELEGRAM_API_HASH', 'TELEGRAM_SESSION'],
    },
  ],
}

export function getSourceActivationModes(source: SourceId): readonly SourceActivationMode[] {
  const explicit = SOURCE_ACTIVATION_MODES[source]
  if (explicit) return explicit

  const required = getSourceConfig(source).requiredEnvVars
  return required.length > 0
    ? [{ id: 'required-env', allOf: required }]
    : []
}

export function evaluateSourceActivation(
  source: SourceId,
  suppliedEnv: Readonly<Record<string, string | undefined>> = {},
  inheritedEnv: Readonly<Record<string, string | undefined>> = process.env,
): SourceActivationResult {
  const modes = getSourceActivationModes(source)

  if (POLICY_UNAVAILABLE_SOURCES.has(source)) {
    return {
      state: 'unavailable',
      mode: null,
      acceptedModes: modes,
      missingByMode: {},
    }
  }

  if (modes.length === 0) {
    return {
      state: 'configured',
      mode: 'public-or-derived',
      acceptedModes: modes,
      missingByMode: {},
    }
  }

  const hasValue = (name: string) => Boolean(suppliedEnv[name]?.trim() || inheritedEnv[name]?.trim())
  const missingByMode: Record<string, readonly string[]> = {}
  for (const mode of modes) {
    const missing = mode.allOf.filter((name) => !hasValue(name))
    missingByMode[mode.id] = missing
    if (missing.length === 0) {
      return {
        state: 'configured',
        mode: mode.id,
        acceptedModes: modes,
        missingByMode,
      }
    }
  }

  return {
    state: 'credential-gated',
    mode: null,
    acceptedModes: modes,
    missingByMode,
  }
}
