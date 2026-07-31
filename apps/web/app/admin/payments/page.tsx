import type { Metadata } from "next";
import Link from "next/link";
import { revalidatePath } from "next/cache";

import { checkOperatorAccess } from "@/lib/operator-auth";
import { buildPaymentReadinessReport } from "@/lib/payment-readiness";
import {
  getNpdReceiptSummary,
  listNpdReceiptTasks,
  markNpdReceiptCanceled,
  markNpdReceiptIssued,
  retryNpdReceiptDelivery,
  type NpdReceiptTask,
} from "@/lib/npdReceipts";
import {
  ContentCard,
  ContentCardTitle,
  InternalPageFrame,
  InternalPageHeader,
  internalPageClasses,
  type NavItem,
} from "../../ui/internal-page";
import { SiteFooter } from "../../ui/site-footer";
import ppStyles from "../../ui/page-primitives.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Платежи и НПД — Recruiter Radar",
  description: "Операторский контроль готовности ЮKassa, НПД-чеков и возвратов.",
  robots: { index: false, follow: false },
};

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Дашборд" },
  { href: "/admin", label: "Оператор" },
  { href: "/admin/payments", label: "Платежи и НПД", active: true },
];

export default async function AdminPaymentsPage() {
  const access = await checkOperatorAccess();
  if (!access.ok) {
    return (
      <InternalPageFrame navItems={NAV} footer={<SiteFooter />}>
        <InternalPageHeader title="Платежи и НПД" />
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
  const [summary, tasks] = await Promise.all([
    getNpdReceiptSummary().catch(() => ({ pendingIssue: 0, cancellationRequired: 0, overdue: 0, deliveryFailed: 0 })),
    listNpdReceiptTasks(200).catch(() => [] as NpdReceiptTask[]),
  ]);

  return (
    <InternalPageFrame navItems={NAV} footer={<SiteFooter />}>
      <InternalPageHeader
        title="Платежи и НПД"
        subtitle="Контроль интеграции ЮKassa, выдачи чеков «Мой налог» и их аннулирования после полного возврата."
      />

      <div style={{ display: "grid", gap: 16 }}>
        <ContentCard>
          <ContentCardTitle>Готовность запуска</ContentCardTitle>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
            <Metric label="Интеграция" value={readiness.selfServePilotReady ? "Готова" : "Заблокирована"} />
            <Metric label="Модерация" value={readiness.merchantModerationReady ? "Готова" : "Заблокирована"} />
            <Metric label="Live" value={readiness.liveLaunchReady ? "Готов" : "Заблокирован"} />
            <Metric label="Режим" value={readiness.mode ?? "не задан"} />
          </div>
          {readiness.launch.blockers.length > 0 ? (
            <ul style={{ margin: "16px 0 0", paddingLeft: 20, display: "grid", gap: 7 }}>
              {readiness.launch.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
            </ul>
          ) : null}
        </ContentCard>

        <ContentCard>
          <ContentCardTitle>Очередь НПД</ContentCardTitle>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            <Metric label="Выдать чек" value={String(summary.pendingIssue)} />
            <Metric label="Просрочено" value={String(summary.overdue)} />
            <Metric label="Аннулировать" value={String(summary.cancellationRequired)} />
            <Metric label="Ошибка отправки" value={String(summary.deliveryFailed)} />
          </div>
          <p className={internalPageClasses.bodyTextMutedBlock} style={{ marginTop: 14 }}>
            Для оплаты картой или другим электронным средством чек НПД нужно формировать без задержки. Ссылка сохраняется только после фактического создания чека в «Мой налог».
          </p>
        </ContentCard>

        {tasks.filter((task) => task.status !== "not_required").map((task) => (
          <ReceiptCard key={task.id} task={task} />
        ))}

        {tasks.length === 0 ? (
          <ContentCard>
            <ContentCardTitle>Задач пока нет</ContentCardTitle>
            <p className={internalPageClasses.bodyTextMutedBlock}>
              После первого подтверждённого платежа ЮKassa здесь автоматически появится задача на выдачу чека.
            </p>
          </ContentCard>
        ) : null}
      </div>
    </InternalPageFrame>
  );
}

function ReceiptCard({ task }: { task: NpdReceiptTask }) {
  const needsIssue = task.status === "pending_issue";
  const needsCancellation = task.status === "cancellation_required";
  const canRetry = task.deliveryStatus === "failed" && (task.status === "issued" || task.status === "canceled");

  return (
    <ContentCard>
      <ContentCardTitle>
        Заказ №{task.checkoutOrderId} · {statusLabel(task.status)}
      </ContentCardTitle>
      <div style={{ display: "grid", gap: 7, fontSize: ".88rem" }}>
        <div>Услуга: <strong>{task.serviceName}</strong></div>
        <div>Сумма: <strong>{formatRub(task.amountRub)}</strong></div>
        <div>Оплата: <strong>{formatDate(task.paymentReceivedAt)}</strong></div>
        <div>Клиент: <strong>{task.customerEmail ?? "e-mail не указан"}</strong></div>
        <div>Платёж ЮKassa: <strong>{task.providerPaymentId ?? "—"}</strong></div>
        <div>Отправка: <strong>{deliveryLabel(task.deliveryStatus)}</strong></div>
        {task.receiptUrl ? <div>Чек: <a href={task.receiptUrl} target="_blank" rel="noreferrer">открыть</a></div> : null}
        {task.lastError ? <div role="alert">Ошибка: <strong>{task.lastError}</strong></div> : null}
      </div>

      {needsIssue ? (
        <form action={markIssuedAction} style={{ display: "grid", gap: 10, marginTop: 16 }}>
          <input type="hidden" name="receiptId" value={task.id} />
          <label className={ppStyles.field}>
            <span className={ppStyles.fieldLabel}>HTTPS-ссылка на чек из «Мой налог»</span>
            <input className={ppStyles.input} type="url" name="receiptUrl" required placeholder="https://..." />
          </label>
          <label className={ppStyles.field}>
            <span className={ppStyles.fieldLabel}>Номер чека — необязательно</span>
            <input className={ppStyles.input} name="receiptNumber" maxLength={160} />
          </label>
          <button className={ppStyles.primaryAction} type="submit">Зафиксировать и отправить клиенту</button>
        </form>
      ) : null}

      {needsCancellation ? (
        <form action={markCanceledAction} style={{ display: "grid", gap: 10, marginTop: 16 }}>
          <input type="hidden" name="receiptId" value={task.id} />
          <label className={ppStyles.field}>
            <span className={ppStyles.fieldLabel}>Причина аннулирования</span>
            <input className={ppStyles.input} name="reason" defaultValue="Возврат средств" maxLength={300} required />
          </label>
          <button className={ppStyles.primaryAction} type="submit">Подтвердить аннулирование в «Мой налог»</button>
        </form>
      ) : null}

      {canRetry ? (
        <form action={retryDeliveryAction} style={{ marginTop: 14 }}>
          <input type="hidden" name="receiptId" value={task.id} />
          <button className={ppStyles.secondaryAction} type="submit">Повторить отправку e-mail</button>
        </form>
      ) : null}
    </ContentCard>
  );
}

async function markIssuedAction(formData: FormData) {
  "use server";
  const access = await checkOperatorAccess();
  if (!access.ok) throw new Error("operator_access_required");
  await markNpdReceiptIssued({
    receiptId: String(formData.get("receiptId") ?? ""),
    receiptUrl: String(formData.get("receiptUrl") ?? ""),
    receiptNumber: String(formData.get("receiptNumber") ?? ""),
  });
  revalidatePath("/admin/payments");
}

async function markCanceledAction(formData: FormData) {
  "use server";
  const access = await checkOperatorAccess();
  if (!access.ok) throw new Error("operator_access_required");
  await markNpdReceiptCanceled({
    receiptId: String(formData.get("receiptId") ?? ""),
    reason: String(formData.get("reason") ?? "Возврат средств"),
  });
  revalidatePath("/admin/payments");
}

async function retryDeliveryAction(formData: FormData) {
  "use server";
  const access = await checkOperatorAccess();
  if (!access.ok) throw new Error("operator_access_required");
  await retryNpdReceiptDelivery(String(formData.get("receiptId") ?? ""));
  revalidatePath("/admin/payments");
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: 14, border: "1px solid rgba(15,23,42,.1)", borderRadius: 12 }}>
      <div style={{ color: "#667085", fontSize: ".75rem" }}>{label}</div>
      <strong style={{ display: "block", marginTop: 5, fontSize: "1.15rem" }}>{value}</strong>
    </div>
  );
}

function statusLabel(status: NpdReceiptTask["status"]): string {
  switch (status) {
    case "pending_issue": return "нужно выдать чек";
    case "issued": return "чек выдан";
    case "cancellation_required": return "нужно аннулировать чек";
    case "canceled": return "чек аннулирован";
    case "not_required": return "чек не требуется";
  }
}

function deliveryLabel(status: NpdReceiptTask["deliveryStatus"]): string {
  switch (status) {
    case "pending": return "ожидает отправки";
    case "sent": return "отправлено";
    case "failed": return "ошибка отправки";
    case "not_required": return "не требуется";
  }
}

function formatRub(amount: number): string {
  return `${new Intl.NumberFormat("ru-RU").format(amount)} ₽`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
