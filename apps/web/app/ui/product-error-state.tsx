import type { ReactNode } from "react";

type RetryAction = {
  label: string;
  onClick?: () => void;
};

export type ProductErrorStateProps = {
  title: string;
  description: string;
  correlationId?: string;
  retryAction?: RetryAction;
  children?: ReactNode;
};

/**
 * Shared production error presentation contract.
 * Runtime adapters may provide correlation ids and telemetry hooks.
 * User-facing copy must not expose backend details.
 */
export function ProductErrorState({
  title,
  description,
  correlationId,
  retryAction,
  children,
}: ProductErrorStateProps) {
  return (
    <section role="alert" aria-labelledby="product-error-title">
      <h2 id="product-error-title">{title}</h2>
      <p>{description}</p>
      {correlationId ? <small>Код обращения: {correlationId}</small> : null}
      {retryAction ? (
        <button type="button" onClick={retryAction.onClick}>
          {retryAction.label}
        </button>
      ) : null}
      {children}
    </section>
  );
}
