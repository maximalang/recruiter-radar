"use client";

import { useEffect, useMemo } from "react";

import { buildAccountNavigation } from "../ui/account-navigation";
import { ProductErrorState } from "../ui/product-error-state";
import { InternalPageFrame, InternalPageHeader } from "../ui/internal-page";

const LEADS_NAV = buildAccountNavigation("leads");

export default function LeadsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const correlationId = useMemo(
    () => error.digest ?? crypto.randomUUID(),
    [error],
  );

  useEffect(() => {
    console.error("[leads] route render failed", { correlationId, name: error.name });
  }, [correlationId, error]);

  return (
    <InternalPageFrame navItems={LEADS_NAV}>
      <InternalPageHeader title="Компании" subtitle="Радар" />
      <ProductErrorState
        title="Не удалось загрузить компании"
        description="Повторите загрузку. Сохранённые данные и статусы не изменились."
        correlationId={correlationId}
        retryAction={{ label: "Повторить", onClick: reset }}
      />
    </InternalPageFrame>
  );
}
