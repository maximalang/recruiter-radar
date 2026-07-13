/**
 * Customer-facing gate presentation. Shared by the public landing preview
 * (app/page.tsx) and the onboarding preview (onboarding/pilot/[orderId]) so
 * both speak the same plain-Russian vocabulary instead of raw "Gate A" jargon.
 *
 * The label semantics mirror lib/scoring/gates.ts (A/B auto-deliver, C review,
 * D context-only) but in words a non-internal user reads. The gate is still
 * stored as A/B/C/D on the row (ConfidenceGate is the persistence type); here
 * we only map that letter to a human label + a short "why this is trustworthy"
 * hint, so a first-time visitor understands the chip without knowing there is
 * an alphabet underneath.
 *
 *   A  2+ independent proofs of hiring        → «Подтверждено»
 *   B  1 direct proof + a cross-check          → «Скорее подтверждено»
 *   C  platform aggregation only, needs review → «Нужна проверка»
 *   D  no direct hiring proof (not a lead)     → «Только контекст»
 */

import type { ConfidenceGate } from "./gates"

export type GatePresentation = {
  color: string
  bg: string
  /** Short chip label, e.g. «Подтверждено». */
  label: string
  /** One-line plain-Russian explanation of why this gate deserves its label. */
  hint: string
}

export const GATE_PRESENTATION: Record<ConfidenceGate, GatePresentation> = {
  A: {
    color: "#065f46",
    bg: "#d1fae5",
    label: "Подтверждено",
    hint: "Найм подтверждён несколькими независимыми источниками"
  },
  B: {
    color: "#1e40af",
    bg: "#dbeafe",
    label: "Скорее подтверждено",
    hint: "Есть прямое доказательство найма и дополнительная проверка"
  },
  C: {
    color: "#92400e",
    bg: "#fef3c7",
    label: "Нужна проверка",
    hint: "Только платформенные сигналы — стоит проверить вручную"
  },
  D: {
    color: "#4b5563",
    bg: "#f3f4f6",
    label: "Только контекст",
    hint: "Прямого доказательства найма нет — в радар не попадает"
  }
}

/** Resolve an unknown runtime gate string to a presentation, or null when not a known gate. */
export function getGatePresentation(gate: string | null | undefined): GatePresentation | null {
  if (!gate) return null
  return gate in GATE_PRESENTATION ? GATE_PRESENTATION[gate as ConfidenceGate] : null
}
