/**
 * Customer-facing gate presentation. Shared by the public landing preview
 * (app/page.tsx) and the onboarding preview (onboarding/pilot/[orderId]) so
 * both speak the same plain-Russian vocabulary instead of raw "Gate A" jargon.
 *
 * The label semantics mirror lib/scoring/gates.ts (A/B auto-deliver, C review,
 * D context-only) but in words a non-internal user reads.
 */

import type { ConfidenceGate } from "./gates"

export type GatePresentation = {
  color: string
  bg: string
  /** Short chip label, e.g. "A — авто". */
  label: string
}

export const GATE_PRESENTATION: Record<ConfidenceGate, GatePresentation> = {
  A: { color: "#065f46", bg: "#d1fae5", label: "A — авто" },
  B: { color: "#1e40af", bg: "#dbeafe", label: "B — авто" },
  C: { color: "#92400e", bg: "#fef3c7", label: "C — проверка" },
  D: { color: "#4b5563", bg: "#f3f4f6", label: "D — контекст" },
}

/** Resolve an unknown runtime gate string to a presentation, or null when not a known gate. */
export function getGatePresentation(gate: string | null | undefined): GatePresentation | null {
  if (!gate) return null
  return gate in GATE_PRESENTATION ? GATE_PRESENTATION[gate as ConfidenceGate] : null
}
