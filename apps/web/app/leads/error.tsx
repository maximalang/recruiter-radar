"use client";

import { useEffect } from "react";

import { buildAccountNavigation } from "../ui/account-navigation";
import { ErrorState, InternalPageFrame, InternalPageHeader } from "../ui/internal-page";

const LEADS_NAV = buildAccountNavigation("leads");

export default function LeadsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[leads] route render failed", { digest: error.digest ?? null, name: error.name });
  }, [error]);

  return (
    <InternalPageFrame navItems={LEADS_NAV}>
      <InternalPageHeader title="Возможности" subtitle="Radar" />
      <ErrorState title="Не удалось загрузить возможности" description="Повторите загрузку. Сохранённые данные и статусы не изменились." retryAction={{ label: "Повторить", onClick: reset }} />
    </InternalPageFrame>
  );
}
