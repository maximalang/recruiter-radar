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
import { SiteFooter } from "../../../../ui/site-footer";

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
    ownedOrder.status === "paid"
      ? ownedOrder
      : (await syncCheckoutOrderAfterSuccessReturn({
          orderId: ownedOrder.id,
          ownerId,
          searchParams: resolvedSearchParams
        })) ?? ownedOrder;

  if (order.status === "paid") {
    redirect(`/onboarding/pilot/${order.id}`);
  }

  const onboardingHref = `/onboarding/pilot/${order.id}`;

  return (
    <PageFrame maxWidth="720px">
      <Link href="/" className={ppStyles.backLink}>На главную</Link>

      <SurfaceCard style={{ display: "grid", gap: "20px" }}>
        <StatusBadge tone="warning">Ждём подтверждение оплаты</StatusBadge>

        <SectionIntro
          title="Платёж ещё подтверждается"
          description="ЮKassa пока не вернула окончательный успешный статус. Повторно оплачивать заказ не нужно."
        />

        <NoticeBox
          tone="info"
          title="Что делать"
          description="Откройте онбординг: заказ автоматически подхватит подтверждённый статус. Обычно обновление занимает несколько минут."
        />

        <div className={ppStyles.summaryBox}>
          <SummaryRow label="Тариф" value={order.payload.planName} />
          <SummaryRow label="Статус оплаты" value={translateOrderStatus(order.status)} />
        </div>

        <div className={ipStyles.chipWrap}>
          <Link href={onboardingHref} className={ppStyles.primaryAction}>Перейти к онбордингу</Link>
          <Link href="/payment-and-delivery" className={ppStyles.secondaryAction}>Оплата и возврат</Link>
        </div>

        <p className={ipStyles.bodyTextMutedBlock} style={{ margin: 0 }}>
          Если статус не обновился, напишите на <a href={`mailto:${OPERATOR_REQUISITES.email}`}>{OPERATOR_REQUISITES.email}</a> и укажите e-mail аккаунта и тариф.
        </p>
      </SurfaceCard>
      <SiteFooter />
    </PageFrame>
  );
}
