import Link from "next/link";
import { notFound } from "next/navigation";

import {
  buildCheckoutRetryHref,
  ensurePilotOrderOnboardingReady,
  markCheckoutOrderCanceled
} from "../../../../../lib/payments";
import { readOwnerSession } from "../../../../../lib/session";
import {
  NoticeBox,
  PageFrame,
  SectionIntro,
  StatusBadge,
  SummaryRow,
  SurfaceCard,
} from "../../../../ui/page-primitives";
import ppStyles from "../../../../ui/page-primitives.module.css";
import { translateOrderStatus } from "../../../../onboarding/pilot/[orderId]/pilot-onboarding-components";
import { internalPageClasses as ipStyles } from "../../../../ui/internal-page";

export const dynamic = "force-dynamic";

type CheckoutCancelPageProps = {
  params: Promise<{ orderId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readReason(searchParams: Record<string, string | string[] | undefined>): string | null {
  const value = searchParams["reason"];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 64) : null;
}

function describeReason(reason: string | null): string {
  switch (reason) {
    case "payment-unavailable":
      return "Оплата сейчас недоступна. Попробуйте ещё раз через несколько минут.";
    case "payment-error":
      return "Провайдер вернул ошибку при создании платежа. Можно повторить попытку.";
    default:
      return "Оплата не была завершена. Это можно повторить в любой момент.";
  }
}

export default async function CheckoutCancelPage({ params, searchParams }: CheckoutCancelPageProps) {
  const resolvedParams = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const ownerId = await readOwnerSession();

  if (!ownerId) {
    notFound();
  }

  const order = await ensurePilotOrderOnboardingReady(resolvedParams.orderId, { ownerId });

  if (!order) {
    notFound();
  }

  const reason = readReason(resolvedSearchParams);

  if (order.status !== "paid") {
    await markCheckoutOrderCanceled(order.id, reason, { ownerId }).catch(() => null);
  }

  const retryHref = buildCheckoutRetryHref(order);

  return (
    <PageFrame maxWidth="720px">
      <Link href="/" className={ppStyles.backLink}>
        На главную
      </Link>

      <SurfaceCard style={{ display: "grid", gap: "20px" }}>
        <StatusBadge tone="warning">Оплата не завершена</StatusBadge>

        <SectionIntro
          title="Платёж не прошёл"
          description={describeReason(reason)}
        />

        <NoticeBox
          tone="info"
          title="Что можно сделать"
          description="Вернитесь к настройкам пилота и повторите оплату. Параметры профиля сохранятся."
        />

        <div className={ppStyles.summaryBox}>
          <SummaryRow label="Тариф" value={order.payload.planName} />
          <SummaryRow label="Статус оплаты" value={translateOrderStatus(order.status)} />
        </div>

        <div className={ipStyles.chipWrap}>
          <Link href={retryHref} className={ppStyles.primaryAction}>
            Повторить оплату
          </Link>
          <Link href="/" className={ppStyles.secondaryAction}>
            На главную
          </Link>
        </div>
      </SurfaceCard>
    </PageFrame>
  );
}
