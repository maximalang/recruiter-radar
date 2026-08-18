import type { Metadata } from "next";
import Link from "next/link";
import { revalidatePath } from "next/cache";

import { checkOperatorAccess } from "@/lib/operator-auth";
import { buildPaymentReadinessReport } from "@/lib/payment-readiness";
import { listRefundableRobokassaOrders } from "@/lib/paymentRefundOrders";
import {
  listPaymentRefunds,
  requestRobokassaRefund,
  syncRobokassaRefund,
} from "@/lib/paymentRefunds";
import {
  ContentCard,
  ContentCardTitle,
  InternalPageFrame,
  InternalPageHeader,
  internalPageClasses,
  type NavItem,
} from "../../ui/internal-page";
import ppStyles from "../../ui/page-primitives.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Платежи Robokassa — Recruiter Radar",
  description: "Операторский контроль оплаты, возвратов и готовности Robokassa.",
  robots: { index: false, follow: false },
};

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Обзор" },
  { href: "/admin", label: "Оператор" },
  { href: "/admin/payments", label: "Платежи", active: true },
];

export default async function AdminPaymentsPage() {
  const access = await checkOperatorAccess();
  if (!access.ok) {
    return (
      <InternalPageFrame navItems={NAV}>
        <InternalPageHeader title="Платежи Robokassa" />
        <div className={internalPageClasses.narrowLayout}>
          <ContentCard>
            <ContentCardTitle>Требуется доступ оператора</ContentCardTitle>
            <p className={internalPageClasses.bodyText}>
              Сначала войдите в <Link href="/admin">панель оператора</Link>.
            </p>
          </ContentCard>
        </div>
      </InternalPageFrame>
    );
  }

  const readiness = buildPaymentReadinessReport();
  const [orders, refunds] = await Promise.all([
    listRefundableRobokassaOrders(100).catch(() => []),
    listPaymentRefunds(100).catch(() => []),
  ]);

  return (
    <InternalPageFrame navItems={NAV}>
      <InternalPageHeader
        title="Платежи Robokassa"
        subtitle="Оплаченные заказы, безопасные возвраты и честный статус готовности запуска."
      />

      <div style={{ display: "grid", gap: 16 }}>
        <ContentCard>
          <ContentCardTitle>Готовность</ContentCardTitle>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            <Metric label="Checkout" value={readiness.selfServeCheckoutReady ? "Готов" : "Заблокирован"} />
            <Metric label="Модерация" value={readiness.merchantModerationReady ? "Готова" : "Не готова"} />
            <Metric label="Refund API" value={readiness.refundsConfigured ? "Настроен" : "Не настроен"} />
            <Metric label="Чеки НПД" value={readiness.npdReceiptsConfigured ? "Подключены" : "Не подтверждены"} />
            <Metric label="Live" value={readiness.liveLaunchReady ? "Готов" : "Заблокирован"} />
          </div>
          {readiness.launch.blockers.length > 0 ? (
            <ul style={{ margin: "16px 0 0", paddingLeft: 20, display: "grid", gap: 7 }}>
              {readiness.launch.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
            </ul>
          ) : null}
        </ContentCard>

        <ContentCard>
          <ContentCardTitle>Оплаченные заказы</ContentCardTitle>
          <p className={internalPageClasses.bodyTextMutedBlock}>
            Возврат создаётся только для подтверждённой Robokassa-операции с сохранённым OpKey. Сумма резервируется в PostgreSQL до обращения к Refund API, поэтому параллельные возвраты не могут превысить оплату.
          </p>
        </ContentCard>

        {orders.map((order) => (
          <ContentCard key={order.id}>
            <ContentCardTitle>Заказ №{order.id} · {order.planName}</ContentCardTitle>
            <div style={{ display: "grid", gap: 7, fontSize: ".88rem" }}>
              <div>Клиент: <strong>{order.customerName ?? "—"}</strong> · {order.customerContact ?? "—"}</div>
              <div>Оплачено: <strong>{formatRub(order.amountMinor)}</strong></div>
              <div>Успешно возвращено: <strong>{formatRub(order.succeededMinor)}</strong></div>
              <div>Зарезервировано всего: <strong>{formatRub(order.reservedMinor)}</strong></div>
              <div>Доступно для возврата: <strong>{formatRub(order.availableMinor)}</strong></div>
              <div>Статус: <strong>{order.status}</strong></div>
              <div>OpKey: <strong>{order.opKey ? "получен" : "отсутствует"}</strong></div>
              <div>Оплата: <strong>{formatDate(order.paidAt)}</strong></div>
            </div>

            {order.status === "paid" && order.availableMinor > 0 ? (
              <form action={requestRefundAction} style={{ display: "grid", gap: 10, marginTop: 16 }}>
                <input type="hidden" name="orderId" value={order.id} />
                <input type="hidden" name="workspaceId" value={order.workspaceId} />
                <input type="hidden" name="entitlementOwnerId" value={order.entitlementOwnerId} />
                <label className={ppStyles.field}>
                  <span className={ppStyles.fieldLabel}>Сумма возврата, ₽</span>
                  <input
                    className={ppStyles.input}
                    name="amountRub"
                    inputMode="decimal"
                    required
                    defaultValue={formatInputRub(order.availableMinor)}
                    pattern="^\\d+(?:[.,]\\d{1,2})?$"
                  />
                </label>
                <button
                  type="submit"
                  className={ppStyles.primaryAction}
                  disabled={!order.opKey || !readiness.refundsConfigured}
                >
                  Создать возврат через Robokassa
                </button>
                {!order.opKey ? (
                  <p role="alert" className={internalPageClasses.bodyTextMutedBlock}>
                    Refund API требует live OpKey. Сначала выполните сверку платежа через OpStateExt.
                  </p>
                ) : null}
              </form>
            ) : null}
          </ContentCard>
        ))}

        {orders.length === 0 ? (
          <ContentCard>
            <ContentCardTitle>Оплаченных заказов пока нет</ContentCardTitle>
            <p className={internalPageClasses.bodyTextMutedBlock}>
              После первого подтверждённого платежа Robokassa заказ появится здесь.
            </p>
          </ContentCard>
        ) : null}

        <ContentCard>
          <ContentCardTitle>История возвратов</ContentCardTitle>
          {refunds.length === 0 ? (
            <p className={internalPageClasses.bodyTextMutedBlock}>Возвратов пока нет.</p>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {refunds.map((refund) => (
                <div key={refund.id} style={{ padding: 14, border: "1px solid rgba(15,23,42,.1)", borderRadius: 12 }}>
                  <div><strong>Возврат №{refund.id}</strong> · заказ №{refund.orderId}</div>
                  <div style={{ marginTop: 6, fontSize: ".84rem" }}>
                    {formatRub(refund.amountMinor)} · {refund.status} · {formatDate(refund.createdAt)}
                  </div>
                  {refund.errorMessage ? <p role="alert">{refund.errorMessage}</p> : null}
                  {refund.providerRefundId && !["succeeded", "failed"].includes(refund.status) ? (
                    <form action={syncRefundAction} style={{ marginTop: 10 }}>
                      <input type="hidden" name="refundId" value={refund.id} />
                      <button type="submit" className={ppStyles.secondaryAction}>Проверить статус в Robokassa</button>
                    </form>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </ContentCard>
      </div>
    </InternalPageFrame>
  );
}

async function requestRefundAction(formData: FormData) {
  "use server";
  const access = await checkOperatorAccess();
  if (!access.ok) throw new Error("operator_access_required");
  await requestRobokassaRefund({
    orderId: String(formData.get("orderId") ?? ""),
    workspaceId: String(formData.get("workspaceId") ?? ""),
    entitlementOwnerId: String(formData.get("entitlementOwnerId") ?? ""),
    amountMinor: parseRublesToMinor(String(formData.get("amountRub") ?? "")),
    requestedBy: `operator:${access.via}`,
  });
  revalidatePath("/admin/payments");
}

async function syncRefundAction(formData: FormData) {
  "use server";
  const access = await checkOperatorAccess();
  if (!access.ok) throw new Error("operator_access_required");
  await syncRobokassaRefund(String(formData.get("refundId") ?? ""));
  revalidatePath("/admin/payments");
}

function parseRublesToMinor(value: string): number {
  const normalized = value.trim().replace(",", ".");
  const match = normalized.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error("Укажите сумму в рублях с точностью не более двух знаков.");
  const minor = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(minor) || minor <= 0) throw new Error("Некорректная сумма возврата.");
  return minor;
}

function formatRub(amountMinor: number): string {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" }).format(amountMinor / 100);
}

function formatInputRub(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2);
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: 14, border: "1px solid rgba(15,23,42,.1)", borderRadius: 12 }}>
      <div style={{ color: "var(--color-text-tertiary)", fontSize: ".75rem" }}>{label}</div>
      <strong style={{ display: "block", marginTop: 5, fontSize: "1.05rem" }}>{value}</strong>
    </div>
  );
}
