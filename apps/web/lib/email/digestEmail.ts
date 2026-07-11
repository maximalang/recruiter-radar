/**
 * Email digest renderer — pure, no I/O.
 *
 * Mirrors the Telegram lead card (`lib/telegram.ts`) in hierarchy and wording so
 * the two channels speak with one voice: company → readiness/score/gate → why
 * now → role signal → safe contact path → sources. A/B (ready to reach out) lead
 * the digest; C (review) follows. Output is inline-styled HTML (email clients
 * strip <style>/external CSS) plus a plain-text fallback.
 */

import type { LeadItem } from "../leads-data";
import { scoreBand, formatSignalStrength } from "../scoring/score-display";
import { buildWhyMatch, type WhyMatchProfile } from "../leads/why-match";
import { pluralCompanies } from "../format/plural";

export type DigestEmailContext = {
  /** Display name of the client profile this digest is for. */
  profileName: string;
  /** App base URL for lead links, e.g. https://app.example.com (no trailing slash). */
  appBaseUrl: string;
  /**
   * Profile filter fields used to compute the per-lead "Почему вам" lines — the
   * same concrete-match rationale the Telegram card shows, so the two channels
   * speak with one voice. Omit to render the digest without the why-match block
   * (e.g. when the profile filters are unavailable).
   */
  profileFilters?: WhyMatchProfile | null;
};

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

type GatePresentation = {
  /** Readiness headline — A/B are ready to reach out, C needs review. */
  readiness: string;
  /** Tone drives the inline color of the readiness line (no emoji). */
  tone: "success" | "info";
};

/**
 * Map a confidence gate to its delivery presentation. Same contract as the
 * Telegram card: A/B = "ready to reach out", C/D = "review manually".
 * Presentation is color-only (no emoji) — the readiness line is tinted green
 * for A/B and blue for review, keeping the email calm and premium.
 */
function getGatePresentation(gate: string | undefined): GatePresentation {
  switch (gate) {
    case "A":
      return { readiness: "Готов к контакту", tone: "success" };
    case "B":
      return { readiness: "Готов к контакту · с пометкой", tone: "success" };
    case "C":
      return { readiness: "На проверку", tone: "info" };
    default:
      return { readiness: "На проверку", tone: "info" };
  }
}

/** Escape the characters that are markup in HTML — applied to every dynamic string. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render the lead score for an email line. `score` is the raw persisted
 * total_score (~200–390); the shared score-display module converts it to the
 * [0,4] signal-strength scale, so the email and Telegram cards show the same
 * value and neither prints the raw "247.0".
 */
function formatScore(score: number | null): string {
  return formatSignalStrength(score);
}

/** A/B sort before C; within a gate, higher score first. Stable on equal keys. */
function gateRank(gate: string): number {
  switch (gate) {
    case "A":
      return 0;
    case "B":
      return 1;
    case "C":
      return 2;
    default:
      return 3;
  }
}

function sortLeadsForDigest(leads: LeadItem[]): LeadItem[] {
  return [...leads].sort((a, b) => {
    const byGate = gateRank(a.confidenceGate) - gateRank(b.confidenceGate);
    if (byGate !== 0) return byGate;
    return b.score - a.score;
  });
}

// --- HTML rendering ---------------------------------------------------------

const COLORS = {
  ink: "#1a1a1a",
  muted: "#6b7280",
  border: "#e5e7eb",
  cardBg: "#ffffff",
  pageBg: "#f6f7f9",
  link: "#2563eb",
  // Readiness / score-band tones — inline-colored labels (no emoji).
  success: "#047857",
  info: "#1d4ed8",
  warning: "#c2410c",
  // Section label color — a quiet uppercase eyebrow above each lead block.
  sectionLabel: "#6b7280",
} as const;

/** Inline color for a score-band tone (matches the web chip). */
function bandColor(tone: "success" | "warning" | "danger"): string {
  if (tone === "success") return COLORS.success;
  if (tone === "warning") return COLORS.warning;
  return COLORS.info;
}

function leadSurfaceUrl(lead: LeadItem, appBaseUrl: string): string {
  return `${appBaseUrl}/leads/${encodeURIComponent(lead.id)}`;
}

/** Narrow a LeadItem to the why-match input shape (same fields the Telegram path passes). */
function toWhyMatchLead(lead: LeadItem) {
  return {
    orgName: lead.orgName,
    evidenceTitles: lead.evidenceTitles,
    locationNames: lead.locationNames,
    vacanciesCount: lead.vacanciesCount,
    score: lead.score,
    latestSignalAt: lead.latestPublishedAt,
  };
}

function renderLeadHtml(lead: LeadItem, appBaseUrl: string, profileFilters?: WhyMatchProfile | null): string {
  const gate = getGatePresentation(lead.confidenceGate);
  const band = scoreBand(lead.score);
  const url = leadSurfaceUrl(lead, appBaseUrl);
  const readinessColor = gate.tone === "success" ? COLORS.success : COLORS.info;

  const blocks: string[] = [];

  // Header: company name as the anchor link (no emoji prefix).
  blocks.push(
    `<tr><td style="padding:0 0 4px 0;">` +
      `<a href="${escapeHtml(url)}" style="color:${COLORS.ink};font-size:17px;font-weight:700;text-decoration:none;">${escapeHtml(lead.orgName)}</a>` +
      `</td></tr>`,
  );
  // Readiness line — ≤2 confidence readouts: band + readiness + numeric. The
  // gate letter is encoded in `gate.readiness` («Готов к контакту» /
  // «Готов к контакту · с пометкой» / «На проверку»), so a bare «· A» would
  // repeat the same fact. One contract shared with the Telegram card — see
  // lib/telegram/digest-batch.ts (T6.1/T6.2 de-duplication).
  blocks.push(
    `<tr><td style="padding:0 0 10px 0;color:${COLORS.muted};font-size:13px;">` +
      `<span style="color:${bandColor(band.tone)};font-weight:600;">${escapeHtml(band.label)}</span>` +
      ` · <span style="color:${readinessColor};font-weight:600;">${escapeHtml(gate.readiness)}</span>` +
      ` · ${escapeHtml(formatScore(lead.score))}` +
      `</td></tr>`,
  );

  // Why now — uppercase eyebrow label + body. No emoji.
  if (lead.whyNow && lead.whyNow.trim()) {
    blocks.push(
      `<tr><td style="padding:0 0 2px 0;color:${COLORS.sectionLabel};font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;">Почему сейчас</td></tr>` +
        `<tr><td style="padding:0 0 10px 0;color:${COLORS.ink};font-size:14px;line-height:1.45;">${escapeHtml(lead.whyNow.trim())}</td></tr>`,
    );
  }

  // Why this match — concrete filter criteria the lead satisfies for the agency.
  // Same rationale the Telegram card shows; rendered only when profile filters
  // are available and at least one concrete line is produced.
  const whyMatch = profileFilters ? buildWhyMatch(toWhyMatchLead(lead), profileFilters) : [];
  if (whyMatch.length > 0) {
    const items = whyMatch
      .map(
        (reason) =>
          `<tr><td style="padding:0 0 2px 0;color:${COLORS.ink};font-size:14px;line-height:1.45;">• ${escapeHtml(reason)}</td></tr>`,
      )
      .join("");
    blocks.push(
      `<tr><td style="padding:0 0 2px 0;color:${COLORS.sectionLabel};font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;">Почему вам</td></tr>` +
        items +
        `<tr><td style="padding:0 0 8px 0;"></td></tr>`,
    );
  }

  // Role / hiring signal — top evidence titles with a quiet "Роли" eyebrow.
  if (lead.evidenceTitles && lead.evidenceTitles.length > 0) {
    const top = lead.evidenceTitles.slice(0, 3).map((t) => escapeHtml(t)).join(", ");
    const more = lead.evidenceTitles.length > 3 ? ` +${lead.evidenceTitles.length - 3}` : "";
    const count = lead.vacanciesCount > 0 ? ` (${lead.vacanciesCount} вак.)` : "";
    blocks.push(
      `<tr><td style="padding:0 0 2px 0;color:${COLORS.sectionLabel};font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;">Роли</td></tr>`,
    );
    blocks.push(
      `<tr><td style="padding:0 0 6px 0;color:${COLORS.ink};font-size:14px;">${top}${more}${count}</td></tr>`,
    );
  }

  // Location (first only) — muted line, no emoji.
  if (lead.locationNames && lead.locationNames.length > 0) {
    blocks.push(
      `<tr><td style="padding:0 0 6px 0;color:${COLORS.muted};font-size:13px;">${escapeHtml(lead.locationNames[0])}</td></tr>`,
    );
  }

  // Safe contact path — ink-colored line, no emoji.
  if (lead.lawfulContactPath && lead.lawfulContactPath.trim()) {
    blocks.push(
      `<tr><td style="padding:0 0 6px 0;color:${COLORS.ink};font-size:13px;">${escapeHtml(lead.lawfulContactPath.trim())}</td></tr>`,
    );
  }

  // Sources (trust)
  if (lead.sourceFamilies && lead.sourceFamilies.length > 0) {
    blocks.push(
      `<tr><td style="padding:8px 0 0 0;color:${COLORS.muted};font-size:12px;font-style:italic;">Источники: ${lead.sourceFamilies
        .map((s) => escapeHtml(s))
        .join(", ")}</td></tr>`,
    );
  }

  // Action link
  blocks.push(
    `<tr><td style="padding:12px 0 0 0;">` +
      `<a href="${escapeHtml(url)}" style="color:${COLORS.link};font-size:13px;font-weight:600;text-decoration:none;">Открыть карточку →</a>` +
      `</td></tr>`,
  );

  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.cardBg};border:1px solid ${COLORS.border};border-radius:12px;padding:18px;margin:0 0 14px 0;">` +
    blocks.join("") +
    `</table>`
  );
}

function renderHtml(leads: LeadItem[], ctx: DigestEmailContext): string {
  const cards = leads.map((lead) => renderLeadHtml(lead, ctx.appBaseUrl, ctx.profileFilters)).join("");
  const heading = `Радар на сегодня — ${escapeHtml(ctx.profileName)}`;
  const subhead =
    leads.length === 1
      ? "1 компания, которой стоит написать сегодня"
      : `${leads.length} ${pluralCompanies(leads.length)}, которым стоит написать сегодня`;

  return (
    `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"/>` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0"/>` +
    `<title>${heading}</title></head>` +
    `<body style="margin:0;padding:0;background:${COLORS.pageBg};">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.pageBg};padding:24px 12px;">` +
    `<tr><td align="center">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">` +
    `<tr><td style="padding:0 0 4px 0;color:${COLORS.ink};font-size:20px;font-weight:700;">${heading}</td></tr>` +
    `<tr><td style="padding:0 0 18px 0;color:${COLORS.muted};font-size:14px;">${escapeHtml(subhead)}</td></tr>` +
    `<tr><td>${cards}</td></tr>` +
    `<tr><td style="padding:8px 0 0 0;color:${COLORS.muted};font-size:12px;line-height:1.5;">` +
    `Ежедневный радар Recruiter Radar. Доказательства и «почему сейчас» — внутри карточки.` +
    `</td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}

// --- Plain-text fallback ----------------------------------------------------

function renderLeadText(lead: LeadItem, appBaseUrl: string, profileFilters?: WhyMatchProfile | null): string {
  const gate = getGatePresentation(lead.confidenceGate);
  const band = scoreBand(lead.score);
  const lines: string[] = [];

  // Readiness line — ≤2 confidence readouts, shared contract with the
  // Telegram card (T6.1/T6.2): band + readiness + numeric, no bare gate letter.
  lines.push(lead.orgName);
  lines.push(`${band.label} · ${gate.readiness} · ${formatScore(lead.score)}`);

  if (lead.whyNow && lead.whyNow.trim()) {
    lines.push(`Почему сейчас: ${lead.whyNow.trim()}`);
  }
  const whyMatch = profileFilters ? buildWhyMatch(toWhyMatchLead(lead), profileFilters) : [];
  if (whyMatch.length > 0) {
    lines.push(`Почему вам: ${whyMatch.join("; ")}`);
  }
  if (lead.evidenceTitles && lead.evidenceTitles.length > 0) {
    const top = lead.evidenceTitles.slice(0, 3).join(", ");
    const more = lead.evidenceTitles.length > 3 ? ` +${lead.evidenceTitles.length - 3}` : "";
    const count = lead.vacanciesCount > 0 ? ` (${lead.vacanciesCount} вак.)` : "";
    lines.push(`Роли: ${top}${more}${count}`);
  }
  if (lead.locationNames && lead.locationNames.length > 0) {
    lines.push(`Локация: ${lead.locationNames[0]}`);
  }
  if (lead.lawfulContactPath && lead.lawfulContactPath.trim()) {
    lines.push(`Контакт: ${lead.lawfulContactPath.trim()}`);
  }
  if (lead.sourceFamilies && lead.sourceFamilies.length > 0) {
    lines.push(`Источники: ${lead.sourceFamilies.join(", ")}`);
  }
  lines.push(leadSurfaceUrl(lead, appBaseUrl));

  return lines.join("\n");
}

function renderText(leads: LeadItem[], ctx: DigestEmailContext): string {
  const header = `Радар на сегодня — ${ctx.profileName}`;
  const body = leads.map((lead) => renderLeadText(lead, ctx.appBaseUrl, ctx.profileFilters)).join("\n\n———\n\n");
  return `${header}\n\n${body}\n`;
}

// --- Russian pluralization: see lib/format/plural.ts ------------------------

// --- Public entry -----------------------------------------------------------

/**
 * Render a full digest email from already-fetched leads. Pure: no DB, no env
 * reads, no network. Leads are re-sorted A/B-first then by score so the email
 * order is independent of the caller's query order.
 */
export function renderDigestEmail(leads: LeadItem[], ctx: DigestEmailContext): RenderedEmail {
  const sorted = sortLeadsForDigest(leads);
  const subject =
    sorted.length === 1
      ? `Радар: 1 компания на сегодня — ${ctx.profileName}`
      : `Радар: ${sorted.length} ${pluralCompanies(sorted.length)} на сегодня — ${ctx.profileName}`;

  return {
    subject,
    html: renderHtml(sorted, ctx),
    text: renderText(sorted, ctx),
  };
}
