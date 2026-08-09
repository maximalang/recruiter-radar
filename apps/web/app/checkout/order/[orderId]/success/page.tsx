import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  ensurePilotOrderOnboardingReady,
  syncCheckoutOrderAfterSuccessReturn
} from "../../../../../lib/payments";
import { getSession } from "../../../../../lib/auth-v2/authorization";
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
  const session = await getSession({ permission: "billing:read" });

  if (!session?.workspaceId) {
    notFound();
  }
  const access = {
    workspaceId: session.workspaceId,
    entitlementOwnerId: session.dataOwnerId,
  };

  const ownedOrder = await ensurePilotOrderOnboardingReady(resolvedParams.orderId, access);

  if (!ownedOrder) {
    notFound();
  }

  const order =
    ownedOrder.status === "paid"
      ? ownedOrder
      : (await syncCheckoutOrderAfterSuccessReturn({
          orderId: ownedOrder.id,
          ...access,
          searchParams: resolvedSearchParams
        })) ?? ownedOrder;

  if (order.status === "paid") {
    redirect(`/onboarding/pilot/${order.id}`);
  }

  const onboardingHref = `/onboarding/pilot/${order.id}`;

  return (
    <PageFrame maxWidth="720px">
      <Link href="/" className={ppStyles.backLink}>
        На главную
      </Link>

      <SurfaceCard style={{ display: "grid", gap: "20px" }}>
        <StatusBadge tone="warning">Ждём подтверждение оплаты</StatusBadge>

        <SectionIntro
          title="Платёж ещё подтверждается"
          description="Провайдер пока не сообщил об успешной оплате. Это занимает до нескольких минут."
        />

        <NoticeBox
          tone="info"
          title="Что делать"
          description="Можно открыть онбординг — он подхватит оплату автоматически, как только она подтвердится."
        />

        <div className={ppStyles.summaryBox}>
          <SummaryRow label="Тариф" value={order.payload.planName} />
          <SummaryRow label="Статус оплаты" value={translateOrderStatus(order.status)} />
        </div>

        <div className={ipStyles.chipWrap}>
          <Link href={onboardingHref} className={ppStyles.primaryAction}>
            Перейти к онбордингу
          </Link>
          <Link href="/" className={ppStyles.secondaryAction}>
            На главную
          </Link>
        </div>
      </SurfaceCard>
    </PageFrame>
  );
}
