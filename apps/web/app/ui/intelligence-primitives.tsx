import type {
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";

import styles from "./intelligence-primitives.module.css";

type ConfidenceLevel = "high" | "medium" | "low";

type SectionProps = HTMLAttributes<HTMLElement>;
type DecisionBriefProps = Omit<SectionProps, "title"> & { title?: ReactNode };

function classes(base: string, custom?: string) {
  return custom ? `${base} ${custom}` : base;
}

/**
 * Calm Intelligence primitives.
 * These primitives model information hierarchy rather than generic cards.
 */

export function AppCanvas({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={classes(styles.canvas, className)} data-ui="app-canvas">
      {children}
    </div>
  );
}

export function WorkspaceHeader({
  title,
  eyebrow,
  description,
  meta,
  actions,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className={styles.workspaceHeader} data-ui="workspace-header">
      <div className={styles.workspaceHeaderCopy}>
        {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p className={styles.workspaceHeaderDescription}>{description}</p> : null}
      </div>
      {meta || actions ? (
        <div className={styles.workspaceHeaderAside}>
          {meta}
          {actions}
        </div>
      ) : null}
    </header>
  );
}

export function Zone({
  className,
  children,
  label,
  "aria-label": ariaLabel,
  ...props
}: SectionProps & { label?: string }) {
  return (
    <section
      {...props}
      className={classes(styles.zone, className)}
      data-ui="zone"
      aria-label={ariaLabel ?? label}
    >
      {children}
    </section>
  );
}

export function Separator(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={classes(styles.separator, props.className)} data-ui="separator" role="separator" />;
}

export function DataRow({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={classes(styles.dataRow, className)} data-ui="data-row">
      {children}
    </div>
  );
}

export function LeadRow({ className, children, ...props }: SectionProps) {
  return (
    <article {...props} className={classes(styles.leadRow, className)} data-ui="lead-row">
      {children}
    </article>
  );
}

export function DecisionBrief({ className, children, title, ...props }: DecisionBriefProps) {
  return (
    <section {...props} className={classes(styles.decisionBrief, className)} data-ui="decision-brief">
      {title ? <h2 className={styles.decisionBriefTitle}>{title}</h2> : null}
      {children}
    </section>
  );
}

export function EvidenceRow({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={classes(styles.evidenceRow, className)} data-ui="evidence-row">
      {children}
    </div>
  );
}

export function EvidenceTimeline({ className, children, ...props }: HTMLAttributes<HTMLOListElement>) {
  return (
    <ol {...props} className={classes(styles.evidenceTimeline, className)} data-ui="evidence-timeline">
      {children}
    </ol>
  );
}

export function Provenance({ className, children, ...props }: SectionProps) {
  return (
    <footer {...props} className={classes(styles.provenance, className)} data-ui="provenance">
      {children}
    </footer>
  );
}

export function MetadataLine({ children, label }: { children: ReactNode; label?: ReactNode }) {
  return (
    <p className={styles.metadataLine} data-ui="metadata-line">
      {label ? <strong>{label}</strong> : null}
      <span>{children}</span>
    </p>
  );
}

export function SignalIndicator({ children }: { children: ReactNode }) {
  return <span className={styles.signalIndicator} data-ui="signal-indicator">{children}</span>;
}

export function ConfidenceIndicator({
  level,
  children,
}: {
  level: ConfidenceLevel;
  children: ReactNode;
}) {
  return (
    <span className={styles.confidenceIndicator} data-ui="confidence-indicator" data-level={level}>
      {children}
    </span>
  );
}

export function FilterBar({
  className,
  children,
  label = "Фильтры",
  "aria-label": ariaLabel,
  ...props
}: HTMLAttributes<HTMLDivElement> & { label?: string }) {
  return (
    <div
      {...props}
      className={classes(styles.filterBar, className)}
      data-ui="filter-bar"
      role="group"
      aria-label={ariaLabel ?? label}
    >
      {children}
    </div>
  );
}

export function SearchField({
  label = "Поиск",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <label className={styles.searchField} data-ui="search-field">
      <span className={styles.srOnly}>{label}</span>
      <input type="search" {...props} />
    </label>
  );
}

export function ContextPane({
  className,
  children,
  label,
  "aria-label": ariaLabel,
  ...props
}: SectionProps & { label?: string }) {
  return (
    <aside
      {...props}
      className={classes(styles.contextPane, className)}
      data-ui="context-pane"
      aria-label={ariaLabel ?? label}
    >
      {children}
    </aside>
  );
}

export function EmptyState({
  title,
  description,
  action,
  leading,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  leading?: ReactNode;
}) {
  return (
    <section className={styles.emptyState} data-ui="empty-state">
      {leading}
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {action}
    </section>
  );
}

export function LoadingState({ label = "Загрузка" }: { label?: string }) {
  return (
    <div className={styles.loadingState} data-ui="loading-state" aria-live="polite" aria-label={label}>
      <span className={styles.loadingLine} aria-hidden="true" />
      <span className={styles.loadingLine} aria-hidden="true" />
      <span className={styles.loadingLine} aria-hidden="true" />
    </div>
  );
}
