import Link from "next/link";
import { notFound } from "next/navigation";

import {
  buildCheckoutRetryHref,
  ensurePilotOrderOnboardingReady,
  markCheckoutOrderCanceled
} from "../../../../../lib/payments";
import { getAuthorizedUserId } from "../../../../../lib/auth-v2/authorization";
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
    case "request-received":
      return "Заявка на подключение тарифа получена. Мы свяжемся, чтобы согласовать запуск и оплату.";
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
  const ownerId = await getAuthorizedUserId("billing:read");

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

  // Recurring plans land here as a captured sales request, not a failed payment.
  const isRequest = reason === "request-received";
  const retryHref = buildCheckoutRetryHref(order);

  return (
    <PageFrame maxWidth="720px">
      <Link href="/" className={ppStyles.backLink}>
        На главную
      </Link>

      <SurfaceCard style={{ display: "grid", gap: "20px" }}>
        <StatusBadge tone={isRequest ? "info" : "warning"}>
          {isRequest ? "Заявка получена" : "Оплата не завершена"}
        </StatusBadge>

        <SectionIntro
          title={isRequest ? "Спасибо, заявка сохранена" : "Платёж не прошёл"}
          description={describeReason(reason)}
        />

        <NoticeBox
          tone="info"
          title={isRequest ? "Что дальше" : "Что можно сделать"}
          description={
            isRequest
              ? "Мы свяжемся по указанному контакту, чтобы подключить тариф и согласовать оплату. Параметры профиля сохранены."
              : "Вернитесь к настройкам пилота и повторите оплату. Параметры профиля сохранятся."
          }
        />

        <div className={ppStyles.summaryBox}>
          <SummaryRow label="Тариф" value={order.payload.planName} />
          <SummaryRow
            label={isRequest ? "Статус заявки" : "Статус оплаты"}
            value={translateOrderStatus(order.status)}
          />
        </div>

        <div className={ipStyles.chipWrap}>
          {isRequest ? (
            <Link href="/" className={ppStyles.primaryAction}>
              На главную
            </Link>
          ) : (
            <>
              <Link href={retryHref} className={ppStyles.primaryAction}>
                Повторить оплату
              </Link>
              <Link href="/" className={ppStyles.secondaryAction}>
                На главную
              </Link>
            </>
          )}
        </div>
      </SurfaceCard>
    </PageFrame>
  );
}
