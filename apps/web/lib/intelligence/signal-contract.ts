export type SignalEvidenceReference = {
  source: string
  proof: string
  occurredAt: string
  freshness?: string
}

export type SignalConfidence = {
  gate?: 'A' | 'B' | 'C' | 'D'
  label: string
}

/**
 * Evidence-first UI boundary.
 *
 * This is intentionally a presentation contract, not a scoring contract:
 * domain engines and database models keep their existing semantics while UI
 * surfaces consume the same Signal → Why now → Evidence → Confidence → Action
 * hierarchy.
 */
export type SignalContract = {
  signal: string
  whyNow: string
  evidence: readonly SignalEvidenceReference[]
  confidence: SignalConfidence
  action: string
  timestamp: string
  outcome?: string | null
}

export function createSignalContract(input: SignalContract): SignalContract {
  return {
    ...input,
    confidence: { ...input.confidence },
    evidence: input.evidence.map((reference) => ({ ...reference })),
  }
}
