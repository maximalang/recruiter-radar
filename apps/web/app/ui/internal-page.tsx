import type { ReactNode } from "react";
import Link from "next/link";

import s from "./internal-page.module.css";
import { repairPossiblyMojibakeText } from "../../lib/copy/repair";
import {
  scorePercent,
  scoreTone as scoreToneFromRaw,
  scoreLevelLabel,
  formatSignalStrength,
  scoreBand,
  type ScoreTone as DisplayScoreTone,
} from "../../lib/scoring/score-display";

function repairVisibleNode(value: ReactNode): ReactNode {
  return typeof value === "string" ? repairPossiblyMojibakeText(value) : value;
}

/* ── Top navigation bar ── */

export type NavItem = {
  href: string;
  label: string;
  active?: boolean;
};

export function TopNav(props: {
  items: NavItem[];
}) {
  return (
    <nav className={s.topNav} aria-label="Основная навигация">
      <div className={s.topNavInner}>
        <Link href="/" className={s.topNavBrand}>
          ← Recruiter Radar
        </Link>
        <div className={s.topNavLinks}>
          {props.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={s.topNavLink}
              data-active={item.active ? "true" : undefined}
              aria-current={item.active ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}

/* ── Page frame ── */

export function InternalPageFrame(props: {
  children: ReactNode;
  className?: string;
  navItems?: NavItem[];
}) {
  return (
    <main
      className={`${s.internalPageFrame}${props.className ? ` ${props.className}` : ""}`}
    >
      <a href="#main-content" className={s.skipLink}>Перейти к содержанию</a>
      {props.navItems ? <TopNav items={props.navItems} /> : null}
      <div className={s.internalPageFrameInner} id="main-content">{props.children}</div>
    </main>
  );
}

/* ── Page header ── */

export function InternalPageHeader(props: {
  title: string;
  subtitle?: ReactNode;
  nav?: ReactNode;
}) {
  return (
    <header className={s.internalPageHeader}>
      <div className={s.internalPageHeaderTop}>
        <div>
          <h1 className={s.internalPageTitle}>{repairVisibleNode(props.title)}</h1>
          {props.subtitle ? (
            <div className={s.internalPageSubtitle}>{props.subtitle}</div>
          ) : null}
        </div>
        {props.nav ? <nav className={s.internalPageHeaderNav}>{props.nav}</nav> : null}
      </div>
    </header>
  );
}

/* ── NavLink (for header nav) ── */

export function InternalNavLink(props: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link href={props.href} className={s.navLink}>
      {props.children}
    </Link>
  );
}

/* ── BackLink ── */

export function InternalBackLink(props: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link href={props.href} className={s.internalPageBackLink}>
      {props.children}
    </Link>
  );
}

/* ── Metric card ── */

export function MetricCard(props: {
  label: string;
  value: ReactNode;
  tone?: "success" | "info" | "neutral";
}) {
  return (
    <div className={s.metricCard}>
      <div className={s.metricLabel}>{props.label}</div>
      <div
        className={s.metricValue}
        data-tone={props.tone && props.tone !== "neutral" ? props.tone : undefined}
      >
        {props.value}
      </div>
    </div>
  );
}

/* ── Metric grid ── */

export function MetricGrid(props: { children: ReactNode }) {
  return <div className={s.metricGrid}>{props.children}</div>;
}

/* ── Content card ── */

export function ContentCard(props: {
  children: ReactNode;
  tone?: "neutral" | "danger";
  /** Visual weight: "hero" lifts the decision-driver cards; "muted" recedes advisory blocks. */
  variant?: "default" | "hero" | "muted";
  className?: string;
}) {
  return (
    <section
      className={`${s.contentCard}${props.className ? ` ${props.className}` : ""}`}
      data-tone={props.tone && props.tone !== "neutral" ? props.tone : undefined}
      data-variant={props.variant && props.variant !== "default" ? props.variant : undefined}
    >
      {props.children}
    </section>
  );
}

/* ── Content card title ── */

export function ContentCardTitle(props: {
  children: ReactNode;
  tone?: "neutral" | "danger";
}) {
  return (
    <h2
      className={s.contentCardTitle}
      data-tone={props.tone && props.tone !== "neutral" ? props.tone : undefined}
    >
      {repairVisibleNode(props.children)}
    </h2>
  );
}

/* ── Detail layout ── */

export function DetailLayout(props: {
  main: ReactNode;
  sidebar: ReactNode;
}) {
  return (
    <div className={s.detailLayout}>
      <div className={s.detailMain}>{props.main}</div>
      <div className={s.detailSidebar}>{props.sidebar}</div>
    </div>
  );
}

/* ── Gate badge inline ── */

export const GATE_LABELS: Record<string, string> = {
  A: "Авто (A)",
  B: "Авто с меткой (B)",
  C: "На проверке (C)",
  D: "Не доставлять (D)",
};

export const GATE_DESC: Record<string, string> = {
  A: "2+ независимых источника, чистое совпадение сущности",
  B: "1 сильный источник + обогащение",
  C: "Только платформенная агрегация, требует ревью",
  D: "Контекст без прямого доказательства найма",
};

/**
 * Display labels for `digest_feedback_status` values.
 *
 * The keys mirror the DB enum (none/contacted/replied/won/badfit/snooze/
 * dismissed). Legacy rows with `accepted`/`later`/`call`/`client` (which the
 * enum never contained and the in-app writer no longer emits) are still mapped
 * so any historical row renders a readable label instead of a raw status
 * string — display-only tolerance, no writer emits them.
 */
export const FEEDBACK_LABELS: Record<string, { label: string; icon: string }> = {
  // DB-legal, current in-app vocabulary
  contacted: { label: "В работе", icon: "✋" },
  replied: { label: "Ответили", icon: "💬" },
  won: { label: "Клиент", icon: "🤝" },
  snooze: { label: "Отложено", icon: "⏰" },
  dismissed: { label: "Мимо", icon: "👋" },
  badfit: { label: "Не наш профиль", icon: "❌" },
  // Legacy / display-only — not emitted by the in-app writer (not in the enum)
  accepted: { label: "Беру", icon: "✅" },
  later: { label: "Позже", icon: "⏰" },
  call: { label: "Созвон", icon: "📞" },
  client: { label: "Клиент", icon: "🤝" },
};

export function GateBadgeInline(props: { gate: string }) {
  return (
    <span className={s.gateBadgeInline} data-gate={props.gate} aria-label={`Уровень доверия: ${GATE_LABELS[props.gate] ?? props.gate}`}>
      {repairVisibleNode(GATE_LABELS[props.gate] ?? props.gate)}
    </span>
  );
}

/* ── Feedback badge ── */

const FEEDBACK_SHORT_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(FEEDBACK_LABELS).map(([k, v]) => [k, v.label])
);

export function FeedbackBadge(props: { status: string | null }) {
  if (!props.status || props.status === "none") return null;
  const label = FEEDBACK_SHORT_LABELS[props.status] ?? props.status;
  return <span className={s.feedbackBadge}>{repairVisibleNode(label)}</span>;
}

/* ── Score tone helper ── */

export type ScoreTone = DisplayScoreTone;

/**
 * Tone for a raw `total_score`. Delegates to the shared score-display module so
 * the [0,4] signal-strength scale is computed in exactly one place. Kept as a
 * re-export under this name because several pages import `getScoreTone` directly.
 */
export function getScoreTone(score: number): ScoreTone {
  return scoreToneFromRaw(score);
}

/* ── Score gauge (large, for detail page) ── */

export function ScoreGauge(props: { score: number }) {
  const pct = scorePercent(props.score);
  const tone = scoreToneFromRaw(props.score);
  const strength = formatSignalStrength(props.score);

  return (
    <div className={s.scoreGauge} role="meter" aria-valuenow={Number(strength)} aria-valuemin={0} aria-valuemax={4} aria-label={`Сила сигнала: ${strength} из 4`}>
      <div className={s.scoreGaugeCircle} data-tone={tone}>
        {strength}
      </div>
      <div className={s.scoreGaugeInfo}>
        <div className={s.scoreGaugeLabel}>Сила сигнала</div>
        <div className={s.scoreGaugeLevel} data-tone={tone}>
          {scoreLevelLabel(props.score)}
        </div>
        <div className={s.scoreGaugeBar}>
          <div
            className={s.scoreGaugeBarFill}
            data-tone={tone}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

/* ── Score bar (compact, for table rows) ── */

export function ScoreBar(props: { score: number }) {
  const pct = scorePercent(props.score);
  const tone = scoreToneFromRaw(props.score);
  const strength = formatSignalStrength(props.score);

  return (
    <div className={s.scoreBar} title={`Сила сигнала: ${strength} из 4`}>
      <div className={s.scoreBarTrack}>
        <div className={s.scoreBarFill} data-tone={tone} style={{ width: `${pct}%` }} />
      </div>
      <span className={s.scoreBarValue}>{strength}</span>
    </div>
  );
}

/* ── Score band chip (one-glance temperature: Горячий / Тёплый / Холодный) ── */

/**
 * Compact temperature read for a lead, mirroring the Telegram/email card band.
 * Pairs with ScoreBar (which shows the numeric strength) so the list, detail,
 * and delivery channels all speak the same "горячий/тёплый/холодный" language.
 */
export function ScoreBandChip(props: { score: number }) {
  const band = scoreBand(props.score);
  return (
    <span className={s.scoreBandChip} data-tone={band.tone}>
      <span aria-hidden="true">{band.icon}</span>
      {band.label}
    </span>
  );
}

/* ── Signal freshness ── */

/**
 * Human "сигнал N дн. назад" cue from the latest hiring-signal date. Returns
 * null when there is no usable date, so callers can drop it in unconditionally.
 * `tone` lets the UI accent a fresh signal (≤7d) and mute a stale one (>30d).
 */
export function formatSignalFreshness(
  latestPublishedAt: string | null,
): { label: string; tone: "fresh" | "recent" | "stale" } | null {
  if (!latestPublishedAt) return null;
  const ts = new Date(latestPublishedAt).getTime();
  if (Number.isNaN(ts)) return null;
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days < 0) return null;
  const tone = days <= 7 ? "fresh" : days <= 30 ? "recent" : "stale";
  if (days === 0) return { label: "сигнал сегодня", tone };
  if (days === 1) return { label: "сигнал вчера", tone };
  return { label: `сигнал ${days} дн. назад`, tone };
}

export function SignalFreshnessChip(props: { latestPublishedAt: string | null }) {
  const fresh = formatSignalFreshness(props.latestPublishedAt);
  if (!fresh) return null;
  return (
    <span className={s.freshnessChip} data-tone={fresh.tone}>
      🕔 {fresh.label}
    </span>
  );
}

/* ── AI-hint presence chip ── */

/**
 * Compact "this lead carries an AI advisory layer" marker. Presence only — the
 * actual attributed hint renders on the detail page (AiEnrichmentBlock). Lets a
 * recruiter spot which list rows have extra AI context before drilling in.
 */
export function AiHintChip(props: { present: boolean }) {
  if (!props.present) return null;
  return (
    <span className={s.aiHintChip} title="Для этого лида есть AI-подсказка по найму">
      ✨ AI
    </span>
  );
}

/* ── Foreign-employer badge ── */

/**
 * «Иностранный работодатель» marker — set when the geo gate flagged the lead as
 * a foreign-ATS employer with no RU footprint. Presence only; the score already
 * reflects the soft foreign penalty. Renders nothing when the lead is domestic.
 */
export function ForeignEmployerBadge(props: { isForeign: boolean }) {
  if (!props.isForeign) return null;
  return (
    <span className={s.foreignBadge} title="Иностранный работодатель — сигнал только на зарубежном ATS, релевантность для рынка РФ понижена">
      🌍 Иностранный работодатель
    </span>
  );
}

/* ── Review-status badge (analyst gate) ── */

/**
 * Display labels for `digest_candidates.review_status`.
 *
 * `auto_approved` is the default and is intentionally NOT surfaced (no badge =
 * no review needed). `pending_review` shows "На проверке" — the SAME wording
 * the gate-C label uses, so /leads, /review, and /dashboard speak one
 * vocabulary. `approved`/`rejected` are analyst decisions written by /api/review.
 */
export const REVIEW_LABELS: Record<string, { label: string; icon: string; tone: 'info' | 'success' | 'danger' }> = {
  pending_review: { label: 'На проверке', icon: '🔍', tone: 'info' },
  approved: { label: 'Проверен', icon: '✓', tone: 'success' },
  rejected: { label: 'Отклонён', icon: '✕', tone: 'danger' },
};

/**
 * Inline review-status badge. Returns null for auto_approved / unknown so the
 * default case renders no badge (the lead simply reads as a normal lead).
 */
export function ReviewStatusBadge(props: { status: string | null }) {
  if (!props.status || props.status === 'auto_approved') return null;
  const entry = REVIEW_LABELS[props.status];
  if (!entry) return null;
  return (
    <span
      className={s.reviewBadge}
      data-tone={entry.tone}
      title={
        props.status === 'pending_review'
          ? 'Требует проверки аналитиком перед доставкой как лид'
          : props.status === 'approved'
            ? 'Проверен аналитиком — доставлен как лид'
            : 'Отклонён аналитиком — скрыт из радара'
      }
    >
      {entry.icon} {entry.label}
    </span>
  );
}

/* ── Urgency cue chip ── */

/**
 * Concrete urgency cue (burst / active / fresh / stale) for the lead card, so the
 * recruiter reads the hiring tempo without opening the lead. `stale` carries a
 * downgrade tone; everything else is neutral-to-positive.
 */
export function UrgencyCueChip(props: { level: string; label: string }) {
  const tone =
    props.level === 'burst' ? 'success'
    : props.level === 'active' ? 'info'
    : props.level === 'fresh' ? 'success'
    : props.level === 'stale' ? 'danger'
    : 'neutral';
  const icon =
    props.level === 'burst' ? '🔥'
    : props.level === 'active' ? '📈'
    : props.level === 'fresh' ? '🆕'
    : props.level === 'stale' ? '🕓'
    : '•';
  return (
    <span className={s.urgencyCueChip} data-tone={tone}>
      {icon} {props.label}
    </span>
  );
}

/* ── Evidence tag ── */

export function EvidenceTag(props: { children: ReactNode }) {
  return <span className={s.evidenceTag}>{props.children}</span>;
}

/* ── Source chip ── */

export function SourceChip(props: { children: ReactNode }) {
  return <span className={s.sourceChip}>{props.children}</span>;
}

/* ── Empty state ── */

export function EmptyState(props: {
  icon?: string;
  title: string;
  text?: string;
  /** Optional next-step call to action — turns a dead end into a guided step. */
  action?: { href: string; label: string };
}) {
  return (
    <div className={s.emptyState}>
      {props.icon ? <div className={s.emptyStateIcon}>{props.icon}</div> : null}
      <p className={s.emptyStateTitle}>{repairVisibleNode(props.title)}</p>
      {props.text ? <p className={s.emptyStateText}>{repairVisibleNode(props.text)}</p> : null}
      {props.action ? (
        <Link href={props.action.href} className={s.emptyStateAction}>
          {repairVisibleNode(props.action.label)}
        </Link>
      ) : null}
    </div>
  );
}

/* ── Not-found state ── */

/** Full-page "not found" state. Use *instead of* InternalPageFrame, not nested inside it —
 *  otherwise you'd get `<main>` inside `<main>`. */
export function NotFoundState(props: {
  icon?: string;
  title: string;
  backHref: string;
  backLabel: string;
}) {
  return (
    <div className={s.notFoundState}>
      <div className={s.notFoundContent}>
        {props.icon ? <div className={s.emptyStateIcon}>{props.icon}</div> : null}
        <p className={s.emptyStateTitle}>{props.title}</p>
        <InternalBackLink href={props.backHref}>{props.backLabel}</InternalBackLink>
      </div>
    </div>
  );
}

/* ── Table card ── */

export function TableCard(props: { children: ReactNode }) {
  return <div className={s.tableCard}>{props.children}</div>;
}

/* ── CSS class re-exports for use in sub-components ── */

export const internalPageClasses = s;
