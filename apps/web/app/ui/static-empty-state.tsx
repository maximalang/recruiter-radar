import { useId, type ComponentType, type ReactNode, type SVGProps } from "react";

type EmptyStateIcon = ComponentType<SVGProps<SVGSVGElement>>;

export function StaticEmptyState({
  title,
  description,
  action,
  icon: Icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: EmptyStateIcon;
}) {
  const titleId = useId();

  return (
    <section aria-labelledby={titleId}>
      {Icon ? <Icon aria-hidden="true" focusable="false" /> : null}
      <h2 id={titleId}>{title}</h2>
      {description ? <p>{description}</p> : null}
      {action}
    </section>
  );
}

export function DynamicStatusMessage({ children }: { children: ReactNode }) {
  return <div role="status" aria-live="polite">{children}</div>;
}
