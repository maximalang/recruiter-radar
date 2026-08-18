import type { ReactNode } from "react";

import { EmptyState as LegacyEmptyState, ErrorState as LegacyErrorState } from "./internal-page";

export function StaticEmptyState(props: {
  title: string;
  text?: string;
  action?: { href: string; label: string };
}) {
  return <LegacyEmptyState {...props} />;
}

export function ProductErrorState(props: {
  title: string;
  description?: ReactNode;
  action?: { href: string; label: string };
  retryAction?: { label: string; onClick: () => void };
}) {
  return <LegacyErrorState {...props} />;
}

export function DynamicStatusMessage(props: { children: ReactNode }) {
  return <div role="status" aria-live="polite">{props.children}</div>;
}
