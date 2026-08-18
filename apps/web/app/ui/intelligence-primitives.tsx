import type { ReactNode } from "react";

/**
 * Calm Intelligence primitives.
 * These primitives intentionally model information hierarchy rather than cards.
 */

export function AppCanvas({ children }: { children: ReactNode }) {
  return <main data-ui="app-canvas">{children}</main>;
}

export function Zone({
  children,
  label,
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <section data-ui="zone" aria-label={label}>
      {children}
    </section>
  );
}

export function Separator() {
  return <div data-ui="separator" role="separator" />;
}

export function DataRow({
  children,
}: {
  children: ReactNode;
}) {
  return <div data-ui="data-row">{children}</div>;
}

export function LeadRow({
  children,
}: {
  children: ReactNode;
}) {
  return <article data-ui="lead-row">{children}</article>;
}

export function EvidenceRow({
  children,
}: {
  children: ReactNode;
}) {
  return <div data-ui="evidence-row">{children}</div>;
}

export function ContextPane({
  children,
}: {
  children: ReactNode;
}) {
  return <aside data-ui="context-pane">{children}</aside>;
}

export function EmptyState({
  children,
}: {
  children: ReactNode;
}) {
  return <div data-ui="empty-state">{children}</div>;
}

export function LoadingState() {
  return <div data-ui="loading-state" aria-live="polite" />;
}
