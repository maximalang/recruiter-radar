import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth-v2/authorization";
import { getEffectiveEntitlement } from "@/lib/entitlements";
import { pluralForm } from "@/lib/format/plural";
import { listCheckoutOrdersForAccess } from "@/lib/paymentsRepo";
import type { CheckoutOrderStatus } from "@/lib/paymentsTypes";
import { buildAccountNavigation } from "../../ui/account-navigation";
import {
  InternalPageFrame,
  InternalPageHeader,
} from "../../ui/internal-page";
import { SettingsSection } from "../../ui/settings-section";
import styles from "./access-ledger.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Доступ и оплата — Recruiter Radar",
  description: "Текущий доступ к Радару и история разовых заказов.",
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
        subtitle="Текущий доступ, срок действия и история платёжных операций — как проверяемые факты аккаунта."
      />

      <div className={styles.document}>
        <SettingsSection
          className={styles.section}
          headerClassName={styles.sectionHeader}
          title="Текущий доступ"
          description="Показываем только фактическое состояние доступа, без предположений о подписке или будущих списаниях."
        >
          {access.status === "active" ? (
            <dl className={styles.ledger}>
              <div><dt>Статус</dt><dd>Активен</dd></div>
              <div><dt>Тариф</dt><dd>{access.plan}</dd></div>
              <div><dt>Источник</dt><dd>{accessSourceLabel(access.source)}</dd></div>
              <div><dt>Начало</dt><dd>{formatDate(access.startsAt)}</dd></div>
              <div><dt>Доступ до</dt><dd>{access.expiresAt ? formatDate(access.expiresAt) : "Без даты окончания"}</dd></div>
              {remainingDays !== null ? <div><dt>Осталось</dt><dd>{formatDays(remainingDays)}</dd></div> : null}
              <div><dt>Доступно</dt><dd>{access.features.map(featureLabel).join(", ")}</dd></div>
            </dl>
          ) : (
            <p className={styles.notice}>
              Активного доступа нет. Профиль и история аккаунта сохраняются.
            </p>
          )}

          <div className={styles.actions}>
            <Link className={styles.primaryAction} href="/checkout">
              {access.status === "active" ? "Продлить доступ" : "Выбрать период доступа"}
            </Link>
          </div>
        </SettingsSection>

        <SettingsSection
          className={styles.section}
          headerClassName={styles.sectionHeader}
          title="История заказов"
          description="Отдельный журнал платёжных операций. Он не подменяет текущее состояние доступа."
        >
          {orders === null ? (
            <p className={styles.notice} role="status" aria-live="polite">
              История заказов временно недоступна. Текущий доступ выше остаётся источником истины.
            </p>
          ) : orders.length === 0 ? (
            <p className={styles.muted}>Заказов пока нет.</p>
          ) : (
            <div className={styles.orders} role="list">
              {orders.map((order) => (
                <article key={order.id} className={styles.order} role="listitem">
                  <div className={styles.orderIdentity}>
                    <strong>Заказ #{order.id}</strong>
                    <small>{order.productCode}</small>
                  </div>
                  <span className={styles.orderAmount}>
                    {(order.amountMinor / 100).toLocaleString("ru-RU")} {order.currency}
                  </span>
                  <span className={styles.orderStatus}>{orderStatusLabel(order.status)}</span>
                  <span className={styles.orderMeta}>
                    {order.provider ? `${order.provider} · ` : ""}{formatDate(order.createdAt)}
                  </span>
                </article>
              ))}
            </div>
          )}
        </SettingsSection>
      </div>
    </InternalPageFrame>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short" })
    .format(new Date(value));
}

function formatDays(count: number): string {
  return `${count} ${pluralForm(count, ["день", "дня", "дней"])}`;
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

const ORDER_STATUS_LABELS: Record<CheckoutOrderStatus, string> = {
  created: "Создан",
  pending: "Ожидает оплаты",
  paid: "Оплачен",
  refunded: "Возвращён",
  canceled: "Отменён",
  failed: "Ошибка оплаты",
  unavailable: "Оплата недоступна",
};

function accessSourceLabel(source: keyof typeof ACCESS_SOURCE_LABELS): string {
  return ACCESS_SOURCE_LABELS[source];
}

function featureLabel(feature: keyof typeof FEATURE_LABELS): string {
  return FEATURE_LABELS[feature];
}

function orderStatusLabel(status: CheckoutOrderStatus): string {
  return ORDER_STATUS_LABELS[status];
}
