/**
 * Pure helpers for the profile/settings form — kept in a standalone module
 * (not profile-form.tsx) so they are unit-testable without pulling the client
 * component's `useActionState` + server-action import chain, which couples to
 * next/server and breaks a jsdom test environment at module load.
 *
 * T2.2 — the hiring-mode badge carries a semantic SVG icon that matches the
 * resolved mode, so the agency sees *what the radar is actually doing* at a
 * glance, not just a text label. The mapping lives here so the form badge and
 * any future surface (e.g. dashboard) share one source of truth.
 */
import type { ReactElement, SVGProps } from "react";

import { TargetIcon, TrendIcon, BriefcaseIcon } from "../../ui/icons";
import type { ClientProfile } from "../../../lib/clientProfiles";

/** Resolved hiring mode (never 'auto' — resolve upstream). */
export type ResolvedHiringMode = "specialist" | "executive" | "volume";

type IconCmp = (p: SVGProps<SVGSVGElement>) => ReactElement;

const MODE_ICON: Readonly<Record<ResolvedHiringMode, IconCmp>> = {
  // Specialist / balanced default → target (precise ICP aiming).
  specialist: TargetIcon,
  // Executive search → trend (seniority/leadership framing).
  executive: TrendIcon,
  // Volume / mass hiring → briefcase (hiring-scale framing).
  volume: BriefcaseIcon,
};

/**
 * The semantic SVG glyph for a resolved hiring mode, or null for an unknown
 * mode so the caller renders no icon rather than a wrong one.
 */
export function modeIcon(mode: string): IconCmp | null {
  return (MODE_ICON as Readonly<Record<string, IconCmp>>)[mode] ?? null;
}

/** Re-export so the form can read the profile type without an extra import. */
export type { ClientProfile };
