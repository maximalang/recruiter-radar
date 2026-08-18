import type { ReactNode } from "react";

export function StaticEmptyState({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section aria-label="Пустое состояние">
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {action}
    </section>
  );
}

export function DynamicStatusMessage({ children }: { children: ReactNode }) {
  return <div role="status" aria-live="polite">{children}</div>;
}
