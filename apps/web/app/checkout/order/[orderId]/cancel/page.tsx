import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import {
  buildCheckoutRetryHref,
  ensurePilotOrderOnboardingReady,
  markCheckoutOrderCanceled
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
  const ownerId = (await cookies()).get("rr_user_id")?.value?.trim() ?? null;

  if (!ownerId) {
    notFound();
  }

  const order = await ensurePilotOrderOnboardingReady(resolvedParams.orderId, { ownerId });

  if (!order) {
    notFound();
  }

  const reason = readReason(resolvedSearchParams);

  if (order.status !== "paid") {
    await markCheckoutOrderCanceled(order.id, reason).catch(() => null);
  }

  const retryHref = buildCheckoutRetryHref(order);

  return (
    <PageFrame maxWidth="720px">
      <Link href="/" style={backLinkStyle}>
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

        <div style={summaryBoxStyle}>
          <SummaryRow label="Тариф" value={order.payload.planName} />
          <SummaryRow label="Статус оплаты" value={translateOrderStatus(order.status)} />
        </div>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <Link href={retryHref} style={primaryActionStyle}>
            Повторить оплату
          </Link>
          <Link href="/" style={secondaryActionStyle}>
            На главную
          </Link>
        </div>
      </SurfaceCard>
    </PageFrame>
  );
}
