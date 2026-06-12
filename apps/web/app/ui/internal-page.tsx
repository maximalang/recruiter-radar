import type { ReactNode } from "react";
import Link from "next/link";

import s from "./internal-page.module.css";
import { repairPossiblyMojibakeText } from "../../lib/copy/repair";

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
        {props.nav ? <nav style={{ display: "flex", gap: "12px" }}>{props.nav}</nav> : null}
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
  className?: string;
}) {
  return (
    <section
      className={`${s.contentCard}${props.className ? ` ${props.className}` : ""}`}
      data-tone={props.tone && props.tone !== "neutral" ? props.tone : undefined}
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

export const FEEDBACK_LABELS: Record<string, { label: string; icon: string }> = {
  accepted: { label: "Беру", icon: "✅" },
  dismissed: { label: "Мимо", icon: "👋" },
  later: { label: "Позже", icon: "⏰" },
  contacted: { label: "Уже написал", icon: "✉️" },
  replied: { label: "Ответили", icon: "💬" },
  call: { label: "Созвон", icon: "📞" },
  client: { label: "Клиент", icon: "🤝" },
  badfit: { label: "Не подходит", icon: "❌" },
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

export type ScoreTone = "success" | "warning" | "danger";

export function getScoreTone(score: number, thresholds = { high: 30, mid: 15 }): ScoreTone {
  if (score >= thresholds.high) return "success";
  if (score >= thresholds.mid) return "warning";
  return "danger";
}

/* ── Score gauge (large, for detail page) ── */

const SCORE_LEVEL_LABELS: Record<ScoreTone, string> = {
  success: "Высокий",
  warning: "Средний",
  danger: "Низкий",
};

export function ScoreGauge(props: { score: number; max?: number }) {
  const max = props.max ?? 50;
  const pct = Math.min(Math.round((props.score / max) * 100), 100);
  const tone = getScoreTone(props.score);

  return (
    <div className={s.scoreGauge} role="meter" aria-valuenow={props.score} aria-valuemin={0} aria-valuemax={max} aria-label={`Скоринг: ${props.score} из ${max}`}>
      <div className={s.scoreGaugeCircle} data-tone={tone}>
        {props.score}
      </div>
      <div className={s.scoreGaugeInfo}>
        <div className={s.scoreGaugeLabel}>Скоринг</div>
        <div className={s.scoreGaugeLevel} data-tone={tone} style={{ color: tone === "success" ? "#10b981" : tone === "warning" ? "#f59e0b" : "#ef4444" }}>
          {SCORE_LEVEL_LABELS[tone]}
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

export function ScoreBar(props: { score: number; max?: number }) {
  const max = props.max ?? 50;
  const pct = Math.min(Math.round((props.score / max) * 100), 100);
  const tone = getScoreTone(props.score);

  return (
    <div className={s.scoreBar}>
      <div className={s.scoreBarTrack}>
        <div className={s.scoreBarFill} data-tone={tone} style={{ width: `${pct}%` }} />
      </div>
      <span className={s.scoreBarValue}>{props.score}</span>
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

export function EmptyState(props: {
  icon?: string;
  title: string;
  text?: string;
}) {
  return (
    <div className={s.emptyState}>
      {props.icon ? <div className={s.emptyStateIcon}>{props.icon}</div> : null}
      <p className={s.emptyStateTitle}>{repairVisibleNode(props.title)}</p>
      {props.text ? <p className={s.emptyStateText}>{repairVisibleNode(props.text)}</p> : null}
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
