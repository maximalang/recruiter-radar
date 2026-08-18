import type { ReactNode } from "react";
import Link from "next/link";

export function StaticEmptyState(props: {
  title: string;
  text?: string;
  action?: { href: string; label: string };
}) {
  return (
    <section aria-labelledby="empty-state-title">
      <h2 id="empty-state-title">{props.title}</h2>
      {props.text ? <p>{props.text}</p> : null}
      {props.action ? (
        <Link href={props.action.href}>{props.action.label}</Link>
      ) : null}
    </section>
  );
}

export function ProductErrorState(props: {
  title: string;
  description?: ReactNode;
  action?: { href: string; label: string };
  retryAction?: { label: string; onClick: () => void };
}) {
  return (
    <section role="alert" aria-labelledby="product-error-title">
      <h2 id="product-error-title">{props.title}</h2>
      {props.description ? <p>{props.description}</p> : null}
      {props.action ? (
        <Link href={props.action.href}>{props.action.label}</Link>
      ) : null}
      {props.retryAction ? (
        <button type="button" onClick={props.retryAction.onClick}>
          {props.retryAction.label}
        </button>
      ) : null}
    </section>
  );
}

export function DynamicStatusMessage(props: { children: ReactNode }) {
  return <div role="status" aria-live="polite">{props.children}</div>;
}
