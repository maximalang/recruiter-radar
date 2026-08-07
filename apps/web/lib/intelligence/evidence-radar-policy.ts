import {
  SIGNAL_TAXONOMY,
  decaySignalStrength,
  type NormalizedSignal,
  type NormalizedSignalType,
} from './evidence-radar'

export const EVIDENCE_RADAR_CALIBRATION_VERSION =
  'evidence-radar-calibration-neutral-v1' as const
export const EVIDENCE_RADAR_RECHECK_VERSION =
  'evidence-radar-recheck-v1' as const

export type SignalContextCalibration = {
  signalType: NormalizedSignalType
  industryCoefficients: Readonly<Record<string, number>>
  regionCoefficients: Readonly<Record<string, number>>
  defaultIndustryCoefficient: 1
  defaultRegionCoefficient: 1
  calibrationStatus: 'neutral_unlabeled' | 'validated'
}

export const SIGNAL_CONTEXT_CALIBRATION: readonly SignalContextCalibration[] =
  SIGNAL_TAXONOMY.map((signal) => ({
    signalType: signal.type,
    industryCoefficients: signal.industryCoefficients,
    regionCoefficients: signal.regionCoefficients,
    defaultIndustryCoefficient: 1,
    defaultRegionCoefficient: 1,
    calibrationStatus: 'neutral_unlabeled',
  }))

const CALIBRATION_BY_SIGNAL = new Map(
  SIGNAL_CONTEXT_CALIBRATION.map((item) => [item.signalType, item]),
)

export function signalContextCoefficient(input: {
  signalType: NormalizedSignalType
  industry?: string | null
  regionCode?: string | null
}): {
  total: number
  industry: number
  region: number
  calibrationStatus: SignalContextCalibration['calibrationStatus']
} {
  const calibration = CALIBRATION_BY_SIGNAL.get(input.signalType)
  if (!calibration) throw new Error(`Unknown signal type: ${input.signalType}`)
  const industryKey = normalizeKey(input.industry)
  const regionKey = normalizeKey(input.regionCode)
  const industry = coefficient(
    industryKey ? calibration.industryCoefficients[industryKey] : undefined,
    calibration.defaultIndustryCoefficient,
  )
  const region = coefficient(
    regionKey ? calibration.regionCoefficients[regionKey] : undefined,
    calibration.defaultRegionCoefficient,
  )
  return {
    total: round(industry * region, 4),
    industry,
    region,
    calibrationStatus: calibration.calibrationStatus,
  }
}

export function calibratedSignalWeight(input: {
  signalType: NormalizedSignalType
  strength: number
  industry?: string | null
  regionCode?: string | null
}): {
  baseWeight: number
  contextCoefficient: number
  effectiveWeight: number
  calibrationStatus: SignalContextCalibration['calibrationStatus']
} {
  const taxonomy = SIGNAL_TAXONOMY.find((item) => item.type === input.signalType)
  if (!taxonomy) throw new Error(`Unknown signal type: ${input.signalType}`)
  const context = signalContextCoefficient(input)
  const effectiveWeight = clamp01(
    taxonomy.baseWeight * clamp01(input.strength) * context.total,
  )
  return {
    baseWeight: taxonomy.baseWeight,
    contextCoefficient: context.total,
    effectiveWeight: round(effectiveWeight, 4),
    calibrationStatus: context.calibrationStatus,
  }
}

export type SignalRecheckDecision = {
  version: typeof EVIDENCE_RADAR_RECHECK_VERSION
  status: 'fresh' | 'recheck_due' | 'expired'
  reason:
    | 'within_recheck_window'
    | 'half_life_threshold'
    | 'validity_expired'
    | 'verification_required'
  effectiveStrength: number
  recheckAt: string
}

export function signalRecheckDecision(
  signal: NormalizedSignal,
  now = new Date(),
): SignalRecheckDecision {
  const taxonomy = SIGNAL_TAXONOMY.find((item) => item.type === signal.type)
  if (!taxonomy) throw new Error(`Unknown signal type: ${signal.type}`)
  const validUntil = parseTimestamp(signal.validUntil, 'validUntil')
  const lastSeen = parseTimestamp(signal.lastSeenAt, 'lastSeenAt')
  const recheckAtMs = Math.min(
    validUntil,
    lastSeen + Math.max(1, Math.floor(taxonomy.halfLifeDays / 2)) * DAY_MS,
  )
  const effectiveStrength = decaySignalStrength(
    signal.strength,
    signal.lastSeenAt,
    taxonomy.halfLifeDays,
    now,
  )

  if (now.getTime() > validUntil) {
    return {
      version: EVIDENCE_RADAR_RECHECK_VERSION,
      status: 'expired',
      reason: 'validity_expired',
      effectiveStrength: round(effectiveStrength, 4),
      recheckAt: new Date(recheckAtMs).toISOString(),
    }
  }

  if (now.getTime() >= recheckAtMs) {
    return {
      version: EVIDENCE_RADAR_RECHECK_VERSION,
      status: 'recheck_due',
      reason: effectiveStrength <= signal.strength * .5
        ? 'half_life_threshold'
        : 'verification_required',
      effectiveStrength: round(effectiveStrength, 4),
      recheckAt: new Date(recheckAtMs).toISOString(),
    }
  }

  return {
    version: EVIDENCE_RADAR_RECHECK_VERSION,
    status: 'fresh',
    reason: 'within_recheck_window',
    effectiveStrength: round(effectiveStrength, 4),
    recheckAt: new Date(recheckAtMs).toISOString(),
  }
}

export function dueSignalIdsForRecheck(
  signals: readonly NormalizedSignal[],
  now = new Date(),
): string[] {
  return signals
    .filter((signal) => signalRecheckDecision(signal, now).status !== 'fresh')
    .map((signal) => signal.id)
    .sort()
}

function coefficient(value: number | undefined, fallback: number): number {
  if (value == null) return fallback
  if (!Number.isFinite(value) || value <= 0 || value > 2) {
    throw new Error('signal context coefficient must be within (0, 2]')
  }
  return value
}

function normalizeKey(value: string | null | undefined): string {
  return value?.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '') ?? ''
}

function parseTimestamp(value: string, field: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be a valid timestamp`)
  return parsed
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

const DAY_MS = 86_400_000
