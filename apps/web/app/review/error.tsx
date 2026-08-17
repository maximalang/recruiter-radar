"use client";

import { useEffect } from "react";

import { buildAccountNavigation } from "../ui/account-navigation";
import { ErrorState, InternalPageFrame, InternalPageHeader } from "../ui/internal-page";

const REVIEW_NAV = buildAccountNavigation("review");

export default function ReviewError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[review] route render failed", { digest: error.digest ?? null, name: error.name });
  }, [error]);

  return (
    <InternalPageFrame navItems={REVIEW_NAV}>
      <InternalPageHeader title="На проверке" subtitle="Радар" />
      <ErrorState title="Не удалось загрузить очередь" description="Повторите загрузку. Решения по кандидатам не изменились." retryAction={{ label: "Повторить", onClick: reset }} />
    </InternalPageFrame>
  );
}
