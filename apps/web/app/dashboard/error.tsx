"use client";

import { useEffect } from "react";

import { buildAccountNavigation } from "../ui/account-navigation";
import { ErrorState } from "../ui/internal-page";
import { ProductWorkspaceFrame, ProductWorkspaceHeader } from "../ui/product-workspace";

const DASHBOARD_NAV = buildAccountNavigation("dashboard");

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard] route render failed", {
      digest: error.digest ?? null,
      name: error.name,
    });
  }, [error]);

  return (
    <ProductWorkspaceFrame navItems={DASHBOARD_NAV}>
      <ProductWorkspaceHeader
        title="Не удалось открыть раздел «Сегодня»"
        subtitle="Сессия и сохранённые настройки не изменились."
      />
      <ErrorState
        title="Раздел «Сегодня» временно недоступен"
        description="Повторите загрузку. Если ошибка сохранится, откройте настройки аккаунта."
        retryAction={{ label: "Повторить", onClick: reset }}
      />
    </ProductWorkspaceFrame>
  );
}
