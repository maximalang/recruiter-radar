import type { ComponentType, ReactNode, SVGProps } from "react";

import { EmptyState } from "./intelligence-primitives";

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
    <EmptyState
      title={title}
      description={description}
      action={action}
      leading={Icon ? <Icon aria-hidden="true" focusable="false" /> : undefined}
    />
  );
}

export function DynamicStatusMessage({ children }: { children: ReactNode }) {
  return <div role="status" aria-live="polite">{children}</div>;
}
