import type { ReactNode, ReactElement, SVGProps } from "react";
import Link from "next/link";
import { ProductWorkspaceFrame } from "./product-workspace";
import { WorkspaceHeader } from "./intelligence-primitives";

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

export function FitIcon({ name, ...rest }: { name: string } & SVGProps<SVGSVGElement>) {
  const C = FIT_DIMENSION_ICON_COMPONENT[name];
  return C ? <C {...rest} /> : null;
}

export type NavItem = { href: string; label: string; active?: boolean };

export function InternalPageFrame(props: { children: ReactNode; className?: string; navItems?: NavItem[] }) {
  if (props.navItems) {
    return (
      <ProductWorkspaceFrame navItems={props.navItems}>
        <div className={`${s.internalPageFrameInner}${props.className ? ` ${props.className}` : ""}`}>{props.children}</div>
      </ProductWorkspaceFrame>
    );
  }
  return (
    <main className={`${s.internalPageFrame}${props.className ? ` ${props.className}` : ""}`} data-ui-system="recruiter-radar">
      <a href="#main-content" className={s.skipLink}>Перейти к содержанию</a>
      <div className={s.internalPageFrameInner} id="main-content">{props.children}</div>
    </main>
  );
}

export function InternalPageHeader(props: { title: string; subtitle?: ReactNode; nav?: ReactNode }) {
  return (
    <div style={{ marginBottom: "var(--space-8)" }}>
      <WorkspaceHeader title={repairVisibleNode(props.title)} description={props.subtitle} actions={props.nav ? <nav className={s.internalPageHeaderNav}>{props.nav}</nav> : undefined} />
    </div>
  );
}

export function InternalNavLink(props: { href: string; children: ReactNode }) {
  return <Link href={props.href} className={s.navLink}>{props.children}</Link>;
}

export type StateIcon = (props: SVGProps<SVGSVGElement>) => ReactElement;

export function InternalBackLink(props: { href: string; children: ReactNode; icon?: StateIcon }) {
  const Icon = props.icon ?? BackIcon;
  return <Link href={props.href} className={s.internalPageBackLink}><Icon className={s.backLinkIcon} aria-hidden="true" /> {props.children}</Link>;
}

export function ContentCard(props: { children: ReactNode; tone?: "neutral" | "danger"; variant?: "default" | "hero" | "muted"; className?: string }) {
  return <section className={`${s.contentCard}${props.className ? ` ${props.className}` : ""}`} data-tone={props.tone && props.tone !== "neutral" ? props.tone : undefined} data-variant={props.variant && props.variant !== "default" ? props.variant : undefined}>{props.children}</section>;
}

export function ContentCardTitle(props: { children: ReactNode; tone?: "neutral" | "danger" }) {
  return <h2 className={s.contentCardTitle} data-tone={props.tone && props.tone !== "neutral" ? props.tone : undefined}>{repairVisibleNode(props.children)}</h2>;
}

export function DetailLayout(props: { main: ReactNode; sidebar: ReactNode }) {
  return <div className={s.detailLayout}><div className={s.detailMain}>{props.main}</div><div className={s.detailSidebar}>{props.sidebar}</div></div>;
}

export const GATE_LABELS: Record<string, string> = { A: "Подтверждение A", B: "Подтверждение B", C: "Подтверждение C", D: "Подтверждение D" };
export const GATE_DESC: Record<string, string> = { A: "2+ независимых источника, чистое совпадение сущности", B: "1 сильный источник + обогащение", C: "Только платформенная агрегация, требует ревью", D: "Контекст без прямого доказательства найма" };

export const FEEDBACK_LABELS: Record<string, { label: string; icon: (p: SVGProps<SVGSVGElement>) => ReactElement }> = {
  contacted: { label: "В работе", icon: HandIcon }, replied: { label: "Ответили", icon: ChatIcon }, won: { label: "Клиент", icon: HandshakeIcon }, snooze: { label: "Отложено", icon: ClockIcon }, dismissed: { label: "Мимо", icon: WaveIcon }, badfit: { label: "Не наш профиль", icon: XIcon }, accepted: { label: "Беру", icon: CheckIcon }, later: { label: "Позже", icon: ClockIcon }, call: { label: "Созвон", icon: ChatIcon }, client: { label: "Клиент", icon: HandshakeIcon },
};

const FEEDBACK_SHORT_LABELS: Record<string, string> = Object.fromEntries(Object.entries(FEEDBACK_LABELS).map(([k, v]) => [k, v.label]));
export function FeedbackBadge(props: { status: string | null }) { if (!props.status || props.status === "none") return null; const label = FEEDBACK_SHORT_LABELS[props.status] ?? props.status; return <span className={s.feedbackBadge}>{repairVisibleNode(label)}</span>; }

export type ScoreTone = DisplayScoreTone;
export function getScoreTone(score: number): ScoreTone { return scoreToneFromRaw(score); }

export function formatSignalFreshness(latestPublishedAt: string | null): { label: string; tone: "fresh" | "recent" | "stale" } | null {
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

export const REVIEW_LABELS: Record<string, { label: string; icon: (p: SVGProps<SVGSVGElement>) => ReactElement; tone: 'info' | 'success' | 'danger' }> = {
  pending_review: { label: 'На проверке', icon: SearchIcon, tone: 'info' }, approved: { label: 'Проверен', icon: CheckIcon, tone: 'success' }, rejected: { label: 'Отклонён', icon: XIcon, tone: 'danger' },
};

export function ReviewBadge(props: { status: string | null | undefined }) {
  if (!props.status || props.status === 'auto_approved') return null;
  const meta = REVIEW_LABELS[props.status];
  if (!meta) return null;
  const Icon = meta.icon;
  return <span className={s.reviewBadge} data-tone={meta.tone}><Icon className={s.reviewBadgeIcon} aria-hidden="true" />{repairVisibleNode(meta.label)}</span>;
}
export const ReviewStatusBadge = ReviewBadge;

export function EmptyState(props: { icon?: StateIcon; title: string; text?: string; action?: { href: string; label: string } }) {
  const Icon = props.icon;
  return (
    <div className={s.emptyState} role="status">
      {Icon ? <div className={s.emptyStateIcon}><Icon /></div> : null}
      <p className={s.emptyStateTitle}>{repairVisibleNode(props.title)}</p>
      {props.text ? <p className={s.emptyStateText}>{repairVisibleNode(props.text)}</p> : null}
      {props.action ? <Link href={props.action.href} className={s.emptyStateAction}>{repairVisibleNode(props.action.label)}</Link> : null}
    </div>
  );
}

export function NotFoundState(props: { icon?: StateIcon; title: string; backHref: string; backLabel: string }) {
  const Icon = props.icon;
  return (
    <div className={s.notFoundState}>
      <div className={s.notFoundContent}>
        {Icon ? <div className={s.emptyStateIcon}><Icon /></div> : null}
        <p className={s.emptyStateTitle}>{repairVisibleNode(props.title)}</p>
        <InternalBackLink href={props.backHref}>{props.backLabel}</InternalBackLink>
      </div>
    </div>
  );
}

export function LoadingState(props: { variant?: "skeleton" | "inline" }) {
  const variant = props.variant ?? "inline";
  if (variant === "skeleton") {
    return <div className={s.loadingSkeleton} role="status" aria-busy="true" aria-live="polite"><span className={s.srOnly}>Загрузка…</span><div className={s.loadingSkeletonLine} data-skeleton="true" /><div className={s.loadingSkeletonLine} data-skeleton="true" /><div className={s.loadingSkeletonLine} data-skeleton="true" style={{ width: "55%" }} /></div>;
  }
  return <div className={s.loadingState}>Загрузка…</div>;
}

export function ErrorState(props: { title: string; description?: ReactNode; action?: { href: string; label: string }; retryAction?: { label: string; onClick: () => void } }) {
  return (
    <div className={s.errorState} role="alert" aria-live="assertive">
      <div className={s.errorStateTitle}>{repairVisibleNode(props.title)}</div>
      {props.description ? <div className={s.errorStateText}>{repairVisibleNode(props.description)}</div> : null}
      {props.action ? <a className={s.errorStateAction} href={props.action.href}>{repairVisibleNode(props.action.label)}</a> : null}
      {props.retryAction ? <button type="button" className={s.errorStateAction} onClick={props.retryAction.onClick}>{repairVisibleNode(props.retryAction.label)}</button> : null}
    </div>
  );
}

export const internalPageClasses = s;
