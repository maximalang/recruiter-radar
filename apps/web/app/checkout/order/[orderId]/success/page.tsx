import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  ensurePilotOrderOnboardingReady,
  syncCheckoutOrderAfterSuccessReturn
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

export const dynamic = "force-dynamic";

type CheckoutSuccessPageProps = {
  params: Promise<{ orderId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CheckoutSuccessPage({ params, searchParams }: CheckoutSuccessPageProps) {
  const resolvedParams = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const ownerId = await getAuthorizedUserId("billing:read");
  if (!ownerId) notFound();

  const ownedOrder = await ensurePilotOrderOnboardingReady(resolvedParams.orderId, { ownerId });
  if (!ownedOrder) notFound();

  const order =
    ownedOrder.status === "paid" || ownedOrder.status === "refunded"
      ? ownedOrder
      : (await syncCheckoutOrderAfterSuccessReturn({ orderId: ownedOrder.id, ownerId, searchParams: resolvedSearchParams })) ?? ownedOrder;

  if (order.status === "paid") redirect(`/onboarding/pilot/${order.id}`);

  const isRefunded = order.status === "refunded";
  return (
    <PageFrame maxWidth="720px">
      <Link href="/" className={ppStyles.backLink}>На главную</Link>
      <SurfaceCard style={{ display: "grid", gap: "20px" }}>
        <StatusBadge tone="warning">{isRefunded ? "Средства возвращены" : "Ждём подтверждение оплаты"}</StatusBadge>
        <SectionIntro
          title={isRefunded ? "Этот заказ полностью возвращён" : "Платёж ещё подтверждается"}
          description={
            isRefunded
              ? "Старая ссылка успешной оплаты не может восстановить доступ или повторно изменить финансовый статус заказа."
              : "Статус проверяется по API платёжного провайдера. Возврат браузера на эту страницу сам по себе не выдаёт доступ."
          }
        />
        <NoticeBox
          tone="info"
          title="Что делать"
          description={
            isRefunded
              ? `Для нового периода оформите новый заказ. Вопросы: ${OPERATOR_REQUISITES.email}.`
              : "Подождите несколько минут и обновите страницу. Если платёж списан, но статус не изменился, обратитесь в поддержку и не оплачивайте заказ повторно."
          }
        />
        <div className={ppStyles.summaryBox}>
          <SummaryRow label="Тариф" value={order.payload.planName} />
          <SummaryRow label="Статус оплаты" value={translateOrderStatus(order.status)} />
        </div>
        <div className={ipStyles.chipWrap}>
          {!isRefunded ? <Link href={`/onboarding/pilot/${order.id}`} className={ppStyles.primaryAction}>Проверить статус</Link> : null}
          <Link href="/" className={isRefunded ? ppStyles.primaryAction : ppStyles.secondaryAction}>На главную</Link>
        </div>
      </SurfaceCard>
    </PageFrame>
  );
}
