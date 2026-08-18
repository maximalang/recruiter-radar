import type { ComponentType, ReactNode, SVGProps } from "react";

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
  return (
    <section>
      {Icon ? <Icon aria-hidden="true" focusable="false" /> : null}
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {action}
    </section>
  );
}

export function DynamicStatusMessage({ children }: { children: ReactNode }) {
  return <div role="status" aria-live="polite">{children}</div>;
}
