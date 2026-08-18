"use client";

import { useEffect } from "use client";

import { buildAccountNavigation } from "../ui/account-navigation";
import { ProductErrorState } from "../ui/product-error-state";
import { InternalPageFrame, InternalPageHeader } from "../ui/internal-page";

const REVIEW_NAV = buildAccountNavigation("review");

export default function ReviewError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const correlationId = error.digest ?? crypto.randomUUID();

  useEffect(() => {
    console.error("[review] route render failed", { correlationId, name: error.name });
  }, [correlationId, error]);

  return (
    <InternalPageFrame navItems={REVIEW_NAV}>
      <InternalPageHeader title="На проверке" subtitle="Радар" />
      <ProductErrorState
        title="Не удалось загрузить очередь"
        description="Повторите загрузку. Решения по компаниям не изменились."
        correlationId={correlationId}
        retryAction={{ label: "Повторить", onClick: reset }}
      />
    </InternalPageFrame>
  );
}
