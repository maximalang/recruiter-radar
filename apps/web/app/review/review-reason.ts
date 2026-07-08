/**
 * Phase 4 (T4.5) — derive the single reason a candidate landed in the review
 * queue from already-available fields, without new SQL.
 *
 * The review queue surfaces candidates that are: gate C (platform aggregation,
 * needs analyst eyes), a foreign employer (foreign-ATS signal, RU relevance
 * lowered), or a single-source lead (no independent confirmation). This helper
 * picks the most salient reason and returns a stable key + the SVG icon the
 * chip should render, so the analyst sees *why* a candidate is here at a glance
 * — not just "на проверке".
 *
 * Priority: foreign > gate-C > single-source. A foreign employer is the loudest
 * signal (geo gate), then gate C (the canonical review reason), then a bare
 * single-source lead. Returns null when no reason applies (the candidate should
 * not have been in the queue — defensive).
 */
import type { ReactElement, SVGProps } from "react";

import { AlertIcon, GlobeIcon, LayersIcon } from "../ui/icons";

type IconCmp = (p: SVGProps<SVGSVGElement>) => ReactElement;

export type ReviewReason = {
  key: "foreign" | "gate-c" | "single-source";
  icon: IconCmp;
};

export function deriveReviewReason(input: {
  confidenceGate: string;
  isForeignEmployer: boolean;
  sourceCount: number;
}): ReviewReason | null {
  if (input.isForeignEmployer) {
    return { key: "foreign", icon: GlobeIcon };
  }
  if (input.confidenceGate.toUpperCase() === "C") {
    return { key: "gate-c", icon: AlertIcon };
  }
  if (input.sourceCount <= 1) {
    return { key: "single-source", icon: LayersIcon };
  }
  return null;
}
