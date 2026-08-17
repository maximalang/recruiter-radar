import type { ReactNode, ReactElement, SVGProps } from "react";
import Link from "next/link";
import { BrandLogo } from "./brand-logo";
import { ProductWorkspaceFrame } from "./product-workspace";

import s from "./internal-page.module.css";
import { repairPossiblyMojibakeText } from "../../lib/copy/repair";
import {
  scoreTone as scoreToneFromRaw,
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
      <Icon className={s.reviewBadgeIcon} /> {entry.label}
    </span>
  );
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



/* ── CSS class re-exports for use in sub-components ── */

export const internalPageClasses = s;
