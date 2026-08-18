export type SignalEvidenceReference = {
  source: string
  proof: string
  occurredAt: string
  freshness?: string
}

/**
 * Evidence-first UI boundary.
 * Domain engines can evolve independently while presentation consumes one shape.
 */
export type SignalContract = {
  source: string
  evidence: readonly SignalEvidenceReference[]
  timestamp: string
  confidence: number
  businessImpact: string
  recommendedAction: string
  outcome?: string | null
}

export function createSignalContract(input: SignalContract): SignalContract {
  return {
    ...input,
    evidence: [...input.evidence],
  }
}
