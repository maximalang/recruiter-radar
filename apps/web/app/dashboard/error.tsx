"use client";

import { useEffect, useMemo } from "react";

import { buildAccountNavigation } from "../ui/account-navigation";
import { ProductErrorState } from "../ui/product-error-state";
import { ProductWorkspaceFrame, ProductWorkspaceHeader } from "../ui/product-workspace";

const DASHBOARD_NAV = buildAccountNavigation("dashboard");

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const correlationId = useMemo(
    () => error.digest ?? crypto.randomUUID(),
    [error],
  );

  useEffect(() => {
    console.error("[dashboard] route render failed", {
      correlationId,
      name: error.name,
    });
  }, [correlationId, error]);

  return (
    <ProductWorkspaceFrame navItems={DASHBOARD_NAV}>
      <ProductWorkspaceHeader
        title="Не удалось открыть раздел «Сегодня»"
        subtitle="Сессия и сохранённые настройки не изменились."
      />
      <ProductErrorState
        title="Раздел «Сегодня» временно недоступен"
        description="Повторите загрузку. Если ошибка сохранится, откройте настройки аккаунта."
        correlationId={correlationId}
        retryAction={{ label: "Повторить", onClick: reset }}
      />
    </ProductWorkspaceFrame>
  );
}
