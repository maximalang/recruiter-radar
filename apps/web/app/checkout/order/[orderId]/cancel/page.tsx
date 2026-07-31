import Link from "next/link";
import { notFound } from "next/navigation";

import {
  buildCheckoutRetryHref,
  ensurePilotOrderOnboardingReady,
  markCheckoutOrderCanceled
} from "../../../../../lib/payments";
import { getAuthorizedUserId } from "../../../../../lib/auth-v2/authorization";
import { OPERATOR_REQUISITES } from "../../../../../lib/operatorRequisites";
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
import { SiteFooter } from "../../../../ui/site-footer";

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
      return "Оплата сейчас недоступна. Деньги не списаны; попробуйте ещё раз позже.";
    case "payment-error":
      return "Не удалось создать платёж в ЮKassa. Деньги не списаны; заказ можно оплатить повторно.";
    default:
      return "Оплата не была завершена. Автоматического повторного списания не будет.";
  }
}

export default async function CheckoutCancelPage({ params, searchParams }: CheckoutCancelPageProps) {
  const resolvedParams = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const ownerId = await getAuthorizedUserId("billing:read");

  if (!ownerId) notFound();

  const order = await ensurePilotOrderOnboardingReady(resolvedParams.orderId, { ownerId });
  if (!order) notFound();

  const reason = readReason(resolvedSearchParams);

  if (order.status !== "paid") {
    await markCheckoutOrderCanceled(order.id, reason, { ownerId }).catch(() => null);
  }

  const isRequest = reason === "request-received";
  const retryHref = buildCheckoutRetryHref(order);

  return (
    <PageFrame maxWidth="720px">
      <Link href="/" className={ppStyles.backLink}>На главную</Link>

      <SurfaceCard style={{ display: "grid", gap: "20px" }}>
        <StatusBadge tone={isRequest ? "info" : "warning"}>
          {isRequest ? "Заявка получена" : "Оплата не завершена"}
        </StatusBadge>

        <SectionIntro
          title={isRequest ? "Спасибо, заявка сохранена" : "Платёж не завершён"}
          description={describeReason(reason)}
        />

        <NoticeBox
          tone="info"
          title={isRequest ? "Что дальше" : "Что можно сделать"}
          description={
            isRequest
              ? "Мы свяжемся по указанному контакту, чтобы подключить тариф и согласовать разовую оплату. Параметры профиля сохранены."
              : "Вернитесь к оформлению и создайте новый платёж. Тариф, сумма и параметры радара останутся теми же."
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
            <Link href="/" className={ppStyles.primaryAction}>На главную</Link>
          ) : (
            <Link href={retryHref} className={ppStyles.primaryAction}>Повторить оплату</Link>
          )}
          <Link href="/payment-and-delivery" className={ppStyles.secondaryAction}>Оплата и возврат</Link>
        </div>

        <p className={ipStyles.bodyTextMutedBlock} style={{ margin: 0 }}>
          Поддержка по оплате: <a href={`mailto:${OPERATOR_REQUISITES.email}`}>{OPERATOR_REQUISITES.email}</a>.
        </p>
      </SurfaceCard>
      <SiteFooter />
    </PageFrame>
  );
}
