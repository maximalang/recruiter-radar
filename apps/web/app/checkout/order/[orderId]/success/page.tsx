import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import {
  ensurePilotOrderOnboardingReady,
  syncCheckoutOrderAfterSuccessReturn
} from "../../../../../lib/payments";
import {
  NoticeBox,
  PageFrame,
  SectionIntro,
  StatusBadge,
  SummaryRow,
  SurfaceCard,
  backLinkStyle,
  primaryActionStyle,
  secondaryActionStyle,
  summaryBoxStyle
} from "../../../../ui/page-primitives";
import { translateOrderStatus } from "../../../../onboarding/pilot/[orderId]/pilot-onboarding-components";

export const dynamic = "force-dynamic";

type CheckoutSuccessPageProps = {
  params: Promise<{ orderId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CheckoutSuccessPage({ params, searchParams }: CheckoutSuccessPageProps) {
  const resolvedParams = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const ownerId = (await cookies()).get("rr_user_id")?.value?.trim() ?? null;

  if (!ownerId) {
    notFound();
  }

  const ownedOrder = await ensurePilotOrderOnboardingReady(resolvedParams.orderId, { ownerId });

  if (!ownedOrder) {
    notFound();
  }

  const order =
    ownedOrder.status === "paid"
      ? ownedOrder
      : (await syncCheckoutOrderAfterSuccessReturn({
          orderId: ownedOrder.id,
          searchParams: resolvedSearchParams
        })) ?? ownedOrder;

  if (order.status === "paid") {
    redirect(`/onboarding/pilot/${order.id}`);
  }

  const onboardingHref = `/onboarding/pilot/${order.id}`;

  return (
    <PageFrame maxWidth="720px">
      <Link href="/" style={backLinkStyle}>
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

        <div style={summaryBoxStyle}>
          <SummaryRow label="Тариф" value={order.payload.planName} />
          <SummaryRow label="Статус оплаты" value={translateOrderStatus(order.status)} />
        </div>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <Link href={onboardingHref} style={primaryActionStyle}>
            Перейти к онбордингу
          </Link>
          <Link href="/" style={secondaryActionStyle}>
            На главную
          </Link>
        </div>
      </SurfaceCard>
    </PageFrame>
  );
}
