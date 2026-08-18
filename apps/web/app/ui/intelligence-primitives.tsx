import type { InputHTMLAttributes, ReactNode } from "react";

import styles from "./intelligence-primitives.module.css";

type ConfidenceLevel = "high" | "medium" | "low";

/**
 * Calm Intelligence primitives.
 * These primitives model information hierarchy rather than generic cards.
 */

export function AppCanvas({ children }: { children: ReactNode }) {
  return <div className={styles.canvas} data-ui="app-canvas">{children}</div>;
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

export function Zone({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <section className={styles.zone} data-ui="zone" aria-label={label}>
      {children}
    </section>
  );
}

export function Separator() {
  return <div className={styles.separator} data-ui="separator" role="separator" />;
}

export function DataRow({ children }: { children: ReactNode }) {
  return <div className={styles.dataRow} data-ui="data-row">{children}</div>;
}

export function LeadRow({ children }: { children: ReactNode }) {
  return <article className={styles.leadRow} data-ui="lead-row">{children}</article>;
}

export function DecisionBrief({ children, title }: { children: ReactNode; title?: ReactNode }) {
  return (
    <section className={styles.decisionBrief} data-ui="decision-brief">
      {title ? <h2 className={styles.decisionBriefTitle}>{title}</h2> : null}
      {children}
    </section>
  );
}

export function EvidenceRow({ children }: { children: ReactNode }) {
  return <div className={styles.evidenceRow} data-ui="evidence-row">{children}</div>;
}

export function EvidenceTimeline({ children }: { children: ReactNode }) {
  return <ol className={styles.evidenceTimeline} data-ui="evidence-timeline">{children}</ol>;
}

export function Provenance({ children }: { children: ReactNode }) {
  return <footer className={styles.provenance} data-ui="provenance">{children}</footer>;
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

export function FilterBar({ children, label = "Фильтры" }: { children: ReactNode; label?: string }) {
  return (
    <div className={styles.filterBar} data-ui="filter-bar" role="group" aria-label={label}>
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

export function ContextPane({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <aside className={styles.contextPane} data-ui="context-pane" aria-label={label}>
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
