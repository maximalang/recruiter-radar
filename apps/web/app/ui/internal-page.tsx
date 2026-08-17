import type { ReactNode, ReactElement, SVGProps } from "react";
import Link from "next/link";
import { BrandLogo } from "./brand-logo";
import { ProductWorkspaceFrame } from "./product-workspace";

import s from "./internal-page.module.css";
import { repairPossiblyMojibakeText } from "../../lib/copy/repair";
import {
  scorePercent,
  scoreTone as scoreToneFromRaw,
  scoreLevelLabel,
  formatScorePoints,
  scoreBand,
  type ScoreTone as DisplayScoreTone,
} from "../../lib/scoring/score-display";
import {
  IndustryIcon,
  RoleIcon,
  TargetIcon,
  PinIcon,
  ShieldIcon,
  MailIcon,
  CheckIcon,
  HandIcon,
  ChatIcon,
  HandshakeIcon,
  ClockIcon,
  WaveIcon,
  XIcon,
  SearchIcon,
  FlameIcon,
  TrendIcon,
  SparkIcon,
  DropIcon,
  BriefcaseIcon,
  FileIcon,
  LayersIcon,
  CalendarIcon,
  GlobeIcon,
  BackIcon,
} from "./icons";

function repairVisibleNode(value: ReactNode): ReactNode {
  return typeof value === "string" ? repairPossiblyMojibakeText(value) : value;
}

/**
 * Fit-dimension → SVG icon component map. The lib layer (fit-explanation)
 * keeps a stable string key per dimension; this map turns it into the rendered
 * glyph so the lib never imports presentation. Used by the detail-page fit list.
 */
export const FIT_DIMENSION_ICON_COMPONENT: Record<string, (p: SVGProps<SVGSVGElement>) => ReactElement> = {
  industry: IndustryIcon,
  role: RoleIcon,
  seniority: TargetIcon,
  target: TargetIcon,
  region: PinIcon,
  pin: PinIcon,
  'contact-policy': ShieldIcon,
  shield: ShieldIcon,
  reachability: MailIcon,
  mail: MailIcon,
  exclusions: CheckIcon,
  check: CheckIcon,
};

/** Render a fit-dimension icon by its stable string key. Null for unknown keys. */
export function FitIcon({ name, ...rest }: { name: string } & SVGProps<SVGSVGElement>) {
  const C = FIT_DIMENSION_ICON_COMPONENT[name];
  return C ? <C {...rest} /> : null;
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
          <BrandLogo size="small" />
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
  if (props.navItems) {
    return (
      <ProductWorkspaceFrame navItems={props.navItems}>
        <div className={`${s.internalPageFrameInner}${props.className ? ` ${props.className}` : ""}`}>
          {props.children}
        </div>
      </ProductWorkspaceFrame>
    );
  }

  return (
    <main
      className={`${s.internalPageFrame}${props.className ? ` ${props.className}` : ""}`}
      data-ui-system="recruiter-radar"
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

/**
 * Back affordance — carries a semantic BackIcon SVG by default (replaces the
 * literal "←" character callers used to compose inline). The `icon` prop lets
 * a caller pass a different glyph, but every back link speaks the SVG
 * vocabulary now. The icon is `aria-hidden` because the label text is the
 * accessible name.
 */
export function InternalBackLink(props: {
  href: string;
  children: ReactNode;
  icon?: StateIcon;
}) {
  const Icon = props.icon ?? BackIcon;
  return (
    <Link href={props.href} className={s.internalPageBackLink}>
      <Icon className={s.backLinkIcon} aria-hidden="true" /> {props.children}
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
    <div className={s.metricCard} role="listitem">
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
  return (
    <div className={s.metricGrid} role="list">
      {props.children}
    </div>
  );
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
  A: "Подтверждение A",
  B: "Подтверждение B",
  C: "Подтверждение C",
  D: "Подтверждение D",
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
 *
 * `icon` is an inline-SVG component (from app/ui/icons) so the badge speaks the
 * same visual vocabulary as the rest of the product, not emoji. Callers render
 * it next to the label.
 */
export const FEEDBACK_LABELS: Record<string, { label: string; icon: (p: SVGProps<SVGSVGElement>) => ReactElement }> = {
  // DB-legal, current in-app vocabulary
  contacted: { label: "В работе", icon: HandIcon },
  replied: { label: "Ответили", icon: ChatIcon },
  won: { label: "Клиент", icon: HandshakeIcon },
  snooze: { label: "Отложено", icon: ClockIcon },
  dismissed: { label: "Мимо", icon: WaveIcon },
  badfit: { label: "Не наш профиль", icon: XIcon },
  // Legacy / display-only — not emitted by the in-app writer (not in the enum)
  accepted: { label: "Беру", icon: CheckIcon },
  later: { label: "Позже", icon: ClockIcon },
  call: { label: "Созвон", icon: ChatIcon },
  client: { label: "Клиент", icon: HandshakeIcon },
};

export function GateBadgeInline(props: { gate: string }) {
  return (
    <span className={s.gateBadgeInline} data-gate={props.gate} aria-label={`Уровень подтверждения доказательствами: ${props.gate}`}>
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

export function ConfidenceMeter(props: { score: number }) {
  const pct = scorePercent(props.score);
  const tone = scoreToneFromRaw(props.score);
  const points = formatScorePoints(props.score);

  return (
    <div className={s.scoreGauge} role="meter" aria-valuenow={Number(points)} aria-valuemin={0} aria-valuemax={100} aria-label={`Сила сигнала: ${points} из 100`}>
      <div className={s.scoreGaugeCircle} data-tone={tone}>
        {points}
      </div>
      <div className={s.scoreGaugeInfo}>
        <div className={s.scoreGaugeLabel}>Сила сигнала</div>
        {/* The level label (Высокий/Средний/Низкий) is visible on desktop but
            collapses to sr-only on mobile so it doesn't duplicate the band chip
            (Горячий/Тёплый/Холодный) on a narrow screen. Always announced to AT. */}
        <div className={`${s.scoreGaugeLevel} ${s.srOnlyMobile}`} data-score-level="true" data-tone={tone}>
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

export function ConfidenceTrack(props: { score: number }) {
  const pct = scorePercent(props.score);
  const tone = scoreToneFromRaw(props.score);
  const points = formatScorePoints(props.score);

  return (
    <div className={s.scoreBar} title={`Сила сигнала: ${points} из 100`}>
      <div className={s.scoreBarTrack}>
        <div className={s.scoreBarFill} data-tone={tone} style={{ width: `${pct}%` }} />
      </div>
      <span className={s.scoreBarValue}>{points}</span>
    </div>
  );
}

/* ── Score band chip (one-glance temperature: Горячий / Тёплый / Холодный) ── */

/**
 * Compact temperature read for a lead, mirroring the Telegram/email card band.
 * Pairs with ConfidenceTrack (which shows the numeric strength) so the list, detail,
 * and delivery channels all speak the same "горячий/тёплый/холодный" language.
 */
export function ConfidenceBand(props: { score: number }) {
  const band = scoreBand(props.score);
  const Icon = band.tone === 'success' ? FlameIcon : band.tone === 'warning' ? DropIcon : DropIcon;
  return (
    <span className={s.scoreBandChip} data-tone={band.tone}>
      <Icon className={s.chipIcon} aria-hidden="true" />
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
      <ClockIcon className={s.chipIcon} /> {fresh.label}
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
      <SparkIcon className={s.chipIcon} /> AI
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
      <GlobeIcon className={s.chipIcon} /> Иностранный работодатель
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
export const REVIEW_LABELS: Record<string, { label: string; icon: (p: SVGProps<SVGSVGElement>) => ReactElement; tone: 'info' | 'success' | 'danger' }> = {
  pending_review: { label: 'На проверке', icon: SearchIcon, tone: 'info' },
  approved: { label: 'Проверен', icon: CheckIcon, tone: 'success' },
  rejected: { label: 'Отклонён', icon: XIcon, tone: 'danger' },
};

/**
 * Inline review-status badge. Returns null for auto_approved / unknown so the
 * default case renders no badge (the lead simply reads as a normal lead).
 */
export function ReviewStatusBadge(props: { status: string | null }) {
  if (!props.status || props.status === 'auto_approved') return null;
  const entry = REVIEW_LABELS[props.status];
  if (!entry) return null;
  const Icon = entry.icon;
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
      <Icon className={s.chipIcon} /> {entry.label}
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
  const Icon =
    props.level === 'burst' ? FlameIcon
    : props.level === 'active' ? TrendIcon
    : props.level === 'fresh' ? SparkIcon
    : props.level === 'stale' ? ClockIcon
    : null;
  return (
    <span className={s.urgencyCueChip} data-tone={tone}>
      {Icon ? <Icon className={s.chipIcon} /> : null} {props.label}
    </span>
  );
}

/* ── Lead-detail verdict chips (decision / meta grouping) ── */

/**
 * The one-glance verdict chip row for the lead-detail hero. Splits the previous
 * flat chip row into two visual clusters so the verdict reads separate from
 * metadata:
 *
 *   decision — band (temperature) + gate (confidence) + urgency (tempo). The
 *              three signals that answer "is this worth contacting now?"
 *   meta     — foreign-employer marker + analyst-review status + signal
 *              freshness. Contextual metadata, not the verdict.
 *
 * The meta group is rendered only when at least one meta chip would show, so a
 * clean A/B domestic lead doesn't carry an empty wrapper. Reuses the existing
 * chip primitives — the grouping is layout, not new components.
 */
export function LeadVerdictChips(props: {
  score: number;
  confidenceGate: string;
  isForeignEmployer: boolean;
  reviewStatus: string | null;
  urgencyLevel: string;
  urgencyLabel: string;
  latestPublishedAt: string | null;
}) {
  const showMeta =
    props.isForeignEmployer ||
    (props.reviewStatus != null && props.reviewStatus !== 'auto_approved') ||
    props.latestPublishedAt != null;
  return (
    <div className={s.leadVerdictChips}>
      <span className={s.leadVerdictChipGroup} data-chip-group="decision">
        <ConfidenceBand score={props.score} />
        <GateBadgeInline gate={props.confidenceGate} />
        <UrgencyCueChip level={props.urgencyLevel} label={props.urgencyLabel} />
      </span>
      {showMeta ? (
        <span className={s.leadVerdictChipGroup} data-chip-group="meta">
          <ForeignEmployerBadge isForeign={props.isForeignEmployer} />
          <ReviewStatusBadge status={props.reviewStatus} />
          <SignalFreshnessChip latestPublishedAt={props.latestPublishedAt} />
        </span>
      ) : null}
    </div>
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

/**
 * Inline-SVG icon component type for state primitives. Mirrors the established
 * `(p: SVGProps<SVGSVGElement>) => ReactElement` shape used by FEEDBACK_LABELS,
 * REVIEW_LABELS, and FIT_DIMENSION_ICON_COMPONENT so every glyph comes from
 * the single app/ui/icons vocabulary.
 */
type StateIcon = (p: SVGProps<SVGSVGElement>) => ReactElement;

export function EmptyState(props: {
  /**
   * Semantic SVG glyph (from app/ui/icons). Replaces the previous dead
   * `icon?: string` prop (which 0 callers passed). Rendered inside the icon
   * well; tone comes from the `.emptyStateIcon` CSS (`currentColor`).
   */
  icon?: StateIcon;
  title: string;
  text?: string;
  /** Optional next-step call to action — turns a dead end into a guided step. */
  action?: { href: string; label: string };
}) {
  const Icon = props.icon;
  return (
    <div className={s.emptyState} role="status">
      {Icon ? (
        <div className={s.emptyStateIcon}>
          <Icon />
        </div>
      ) : null}
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
  /** Semantic SVG glyph (from app/ui/icons). */
  icon?: StateIcon;
  title: string;
  backHref: string;
  backLabel: string;
}) {
  const Icon = props.icon;
  return (
    <div className={s.notFoundState}>
      <div className={s.notFoundContent}>
        {Icon ? (
          <div className={s.emptyStateIcon}>
            <Icon />
          </div>
        ) : null}
        <p className={s.emptyStateTitle}>{props.title}</p>
        <InternalBackLink href={props.backHref}>{props.backLabel}</InternalBackLink>
      </div>
    </div>
  );
}

/* ── Loading state ── */

/**
 * Unified Suspense / data-loading fallback. Replaces the flat
 * `<div>Загрузка...</div>` strings scattered across pages so every loading
 * moment speaks one calm vocabulary.
 *
 *   variant="inline"  — a quiet centered text line (reuses `.loadingState`).
 *   variant="skeleton" — an `aria-busy` skeleton block with placeholder bars,
 *                        so a Suspense gap doesn't flash white. Used for
 *                        data-shaped sections (lists, metric grids).
 *
 * Defaults to "inline" so callers can drop it in without a variant for the
 * simple case and opt into skeleton where the shape is known.
 */
export function LoadingState(props: { variant?: "skeleton" | "inline" }) {
  const variant = props.variant ?? "inline";
  if (variant === "skeleton") {
    return (
      <div className={s.loadingSkeleton} role="status" aria-busy="true" aria-live="polite">
        <span className={s.srOnly}>Загрузка…</span>
        <div className={s.loadingSkeletonLine} data-skeleton="true" />
        <div className={s.loadingSkeletonLine} data-skeleton="true" />
        <div className={s.loadingSkeletonLine} data-skeleton="true" style={{ width: "55%" }} />
      </div>
    );
  }
  return <div className={s.loadingState}>Загрузка…</div>;
}

/* ── Error state ── */

/**
 * Unified data-error fallback. When a data surface (analytics, leads, review,
 * today-radar, quality) fails to load, it shows this instead of a raw error
 * string or a silent empty list that reads as "no data". The contract:
 *
 *   - `title` — a short, human sentence: what went wrong (no internals).
 *   - `description` — a concrete next step the user can take (повторите позже /
 *     проверить профиль / написать поддержку), or an honest "собираем данные".
 *   - `action` — optional link to the next step (e.g. /profile).
 *
 * `role="alert"` + `aria-live="assertive"` so AT announces the failure. The
 * raw internal error is NEVER rendered — only the human copy the caller passes.
 * Mirrors `EmptyState`'s calm premium styling so an error reads as a quiet,
 * recoverable moment, not a loud crash.
 */
export function ErrorState(props: {
  title: string;
  description?: ReactNode;
  action?: { href: string; label: string };
  retryAction?: { label: string; onClick: () => void };
}) {
  return (
    <div className={s.errorState} role="alert" aria-live="assertive">
      <div className={s.errorStateTitle}>{repairVisibleNode(props.title)}</div>
      {props.description ? (
        <div className={s.errorStateText}>{repairVisibleNode(props.description)}</div>
      ) : null}
      {props.action ? (
        <a className={s.errorStateAction} href={props.action.href}>
          {repairVisibleNode(props.action.label)}
        </a>
      ) : null}
      {props.retryAction ? (
        <button type="button" className={s.errorStateAction} onClick={props.retryAction.onClick}>
          {repairVisibleNode(props.retryAction.label)}
        </button>
      ) : null}
    </div>
  );
}

/* ── Table card ── */

export function TableCard(props: { children: ReactNode }) {
  return <div className={s.tableCard}>{props.children}</div>;
}

/* ── CSS class re-exports for use in sub-components ── */

export const internalPageClasses = s;
