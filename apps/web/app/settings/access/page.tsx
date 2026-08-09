import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth-v2/authorization";
import { getEffectiveEntitlement } from "@/lib/entitlements";
import { listCheckoutOrdersForAccess } from "@/lib/paymentsRepo";
import { buildAccountNavigation } from "../../ui/account-navigation";
import {
  ContentCard,
  ContentCardTitle,
  InternalPageFrame,
  InternalPageHeader,
  internalPageClasses,
} from "../../ui/internal-page";
import ppStyles from "../../ui/page-primitives.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Доступ и оплата — Recruiter Radar",
  description: "Текущий доступ к Radar и история разовых заказов.",
  robots: { index: false, follow: false },
};

export default async function AccessSettingsPage() {
  const session = await getSession({
    permissions: ["workspace:read", "billing:read"],
  });
  if (!session) redirect("/login?returnTo=/settings/access");
  if (!session.workspaceId) redirect("/settings?notice=workspace-required");

  const [accessResult, ordersResult] = await Promise.allSettled([
    getEffectiveEntitlement(session.dataOwnerId, {
      workspaceId: session.workspaceId,
    }),
    listCheckoutOrdersForAccess({
      workspaceId: session.workspaceId,
      entitlementOwnerId: session.dataOwnerId,
    }),
  ]);
  if (accessResult.status === "rejected") throw accessResult.reason;
  const access = accessResult.value;
  const orders = ordersResult.status === "fulfilled" ? ordersResult.value : null;
  const remainingDays = access.status === "active" && access.expiresAt
    ? Math.max(0, Math.ceil((new Date(access.expiresAt).getTime() - Date.now()) / 86_400_000))
    : null;

  return (
    <InternalPageFrame navItems={buildAccountNavigation("settings")}>
      <InternalPageHeader
        title="Доступ и оплата"
        subtitle="Один источник истины для текущего доступа и отдельная история платёжных операций."
      />
      <div className={internalPageClasses.narrowLayout}>
        <ContentCard variant="hero">
          <ContentCardTitle>Текущий доступ</ContentCardTitle>
          {access.status === "active" ? (
            <dl>
              <div><dt>Статус</dt><dd>Активен</dd></div>
              <div><dt>Тариф</dt><dd>{access.plan}</dd></div>
              <div><dt>Источник</dt><dd>{accessSourceLabel(access.source)}</dd></div>
              <div><dt>Начало</dt><dd>{formatDate(access.startsAt)}</dd></div>
              <div><dt>Доступ до</dt><dd>{access.expiresAt ? formatDate(access.expiresAt) : "Без даты окончания"}</dd></div>
              {remainingDays !== null ? <div><dt>Осталось</dt><dd>{remainingDays} дн.</dd></div> : null}
              <div><dt>Возможности</dt><dd>{access.features.map(featureLabel).join(", ")}</dd></div>
            </dl>
          ) : (
            <p className={internalPageClasses.bodyTextMutedBlock}>
              Активного доступа нет. Профиль и история аккаунта сохраняются.
            </p>
          )}
          <Link className={ppStyles.primaryAction} href="/checkout">Выбрать период доступа</Link>
        </ContentCard>

        <ContentCard>
          <ContentCardTitle>История заказов</ContentCardTitle>
          {orders === null ? (
            <p className={internalPageClasses.bodyTextMutedBlock} role="status">
              История заказов временно недоступна. Текущий доступ показан отдельно и остаётся актуальным.
            </p>
          ) : orders.length === 0 ? (
            <p className={internalPageClasses.bodyTextMutedBlock}>Заказов пока нет.</p>
          ) : (
            <div style={{ display: "grid", gap: "10px" }}>
              {orders.map((order) => (
                <article key={order.id} style={{ borderBottom: "1px solid var(--c-border)", paddingBottom: "10px" }}>
                  <strong>Заказ #{order.id} · {order.productCode}</strong>
                  <p className={internalPageClasses.bodyText}>
                    {(order.amountMinor / 100).toLocaleString("ru-RU")} {order.currency} · {order.status}
                    {order.provider ? ` · ${order.provider}` : ""}
                  </p>
                  <small>{formatDate(order.createdAt)}</small>
                </article>
              ))}
            </div>
          )}
        </ContentCard>
      </div>
    </InternalPageFrame>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short" })
    .format(new Date(value));
}

const ACCESS_SOURCE_LABELS = {
  subscription: "Подписка",
  payment: "Оплаченный доступ",
  admin: "Выдан оператором",
  trial: "Пробный период",
  pilot: "Пилотный доступ",
  promo: "Промо-доступ",
} as const;

const FEATURE_LABELS = {
  dashboard: "Кабинет",
  api: "API",
  digest: "Дайджест",
  delivery: "Каналы доставки",
} as const;

function accessSourceLabel(source: keyof typeof ACCESS_SOURCE_LABELS): string {
  return ACCESS_SOURCE_LABELS[source];
}

function featureLabel(feature: keyof typeof FEATURE_LABELS): string {
  return FEATURE_LABELS[feature];
}
