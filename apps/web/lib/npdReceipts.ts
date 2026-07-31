import { getPool } from "./db-pool";
import { sendEmail, type SendEmailResult } from "./email/transport";
import { logError, logEvent } from "./runtime";

export const NPD_RECEIPT_STATUSES = [
  "pending_issue",
  "issued",
  "cancellation_required",
  "canceled",
  "not_required",
] as const;

export type NpdReceiptStatus = (typeof NPD_RECEIPT_STATUSES)[number];
export type NpdReceiptDeliveryStatus = "pending" | "sent" | "failed" | "not_required";

export type NpdReceiptTask = {
  id: string;
  checkoutOrderId: string;
  userId: string;
  status: NpdReceiptStatus;
  amountRub: number;
  currency: string;
  customerEmail: string | null;
  serviceName: string;
  paymentReceivedAt: string;
  dueAt: string;
  receiptUrl: string | null;
  receiptNumber: string | null;
  issuedAt: string | null;
  canceledAt: string | null;
  cancellationReason: string | null;
  deliveryStatus: NpdReceiptDeliveryStatus;
  deliveredAt: string | null;
  lastError: string | null;
  orderStatus: string;
  providerPaymentId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NpdReceiptSummary = {
  pendingIssue: number;
  cancellationRequired: number;
  overdue: number;
  deliveryFailed: number;
};

type ReceiptRow = {
  id: string;
  checkoutOrderId: string;
  userId: string;
  status: string;
  amountRub: number;
  currency: string;
  customerEmail: string | null;
  serviceName: string;
  paymentReceivedAt: string;
  dueAt: string;
  receiptUrl: string | null;
  receiptNumber: string | null;
  issuedAt: string | null;
  canceledAt: string | null;
  cancellationReason: string | null;
  deliveryStatus: string;
  deliveredAt: string | null;
  lastError: string | null;
  orderStatus: string;
  providerPaymentId: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function listNpdReceiptTasks(limit = 100): Promise<NpdReceiptTask[]> {
  const pool = requirePool();
  const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 500) : 100;
  const result = await pool.query<ReceiptRow>(
    `SELECT
       r.id::text AS "id",
       r.checkout_order_id::text AS "checkoutOrderId",
       r.user_id::text AS "userId",
       r.status,
       r.amount_rub AS "amountRub",
       r.currency,
       r.customer_email AS "customerEmail",
       r.service_name AS "serviceName",
       r.payment_received_at::text AS "paymentReceivedAt",
       r.due_at::text AS "dueAt",
       r.receipt_url AS "receiptUrl",
       r.receipt_number AS "receiptNumber",
       r.issued_at::text AS "issuedAt",
       r.canceled_at::text AS "canceledAt",
       r.cancellation_reason AS "cancellationReason",
       r.delivery_status AS "deliveryStatus",
       r.delivered_at::text AS "deliveredAt",
       r.last_error AS "lastError",
       o.status AS "orderStatus",
       o.provider_payment_id AS "providerPaymentId",
       r.created_at::text AS "createdAt",
       r.updated_at::text AS "updatedAt"
     FROM npd_receipts r
     INNER JOIN checkout_orders o ON o.id = r.checkout_order_id
     ORDER BY
       CASE r.status
         WHEN 'cancellation_required' THEN 0
         WHEN 'pending_issue' THEN 1
         WHEN 'issued' THEN 2
         WHEN 'canceled' THEN 3
         ELSE 4
       END,
       r.due_at ASC,
       r.id ASC
     LIMIT $1`,
    [safeLimit],
  );
  return result.rows.map(normalizeTask);
}

export async function getNpdReceiptSummary(): Promise<NpdReceiptSummary> {
  const pool = requirePool();
  const result = await pool.query<{
    pendingIssue: number;
    cancellationRequired: number;
    overdue: number;
    deliveryFailed: number;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'pending_issue')::int AS "pendingIssue",
       COUNT(*) FILTER (WHERE status = 'cancellation_required')::int AS "cancellationRequired",
       COUNT(*) FILTER (WHERE status = 'pending_issue' AND due_at <= NOW())::int AS "overdue",
       COUNT(*) FILTER (WHERE delivery_status = 'failed')::int AS "deliveryFailed"
     FROM npd_receipts`,
  );
  return result.rows[0] ?? {
    pendingIssue: 0,
    cancellationRequired: 0,
    overdue: 0,
    deliveryFailed: 0,
  };
}

export async function markNpdReceiptIssued(input: {
  receiptId: string | number;
  receiptUrl: string;
  receiptNumber?: string | null;
  issuedAt?: string | Date | null;
}): Promise<NpdReceiptTask> {
  const pool = requirePool();
  const receiptId = normalizePositiveId(input.receiptId);
  const receiptUrl = normalizeHttpsUrl(input.receiptUrl);
  const receiptNumber = normalizeOptionalText(input.receiptNumber, 160);
  const issuedAt = normalizeDate(input.issuedAt) ?? new Date();

  const result = await pool.query<ReceiptRow>(
    `UPDATE npd_receipts r
     SET status = 'issued',
         receipt_url = $2,
         receipt_number = $3,
         issued_at = $4,
         canceled_at = NULL,
         cancellation_reason = NULL,
         delivery_status = CASE WHEN customer_email IS NULL THEN 'not_required' ELSE 'pending' END,
         delivered_at = NULL,
         last_error = NULL
     FROM checkout_orders o
     WHERE r.id = $1
       AND r.checkout_order_id = o.id
       AND r.status IN ('pending_issue', 'issued')
     RETURNING
       r.id::text AS "id",
       r.checkout_order_id::text AS "checkoutOrderId",
       r.user_id::text AS "userId",
       r.status,
       r.amount_rub AS "amountRub",
       r.currency,
       r.customer_email AS "customerEmail",
       r.service_name AS "serviceName",
       r.payment_received_at::text AS "paymentReceivedAt",
       r.due_at::text AS "dueAt",
       r.receipt_url AS "receiptUrl",
       r.receipt_number AS "receiptNumber",
       r.issued_at::text AS "issuedAt",
       r.canceled_at::text AS "canceledAt",
       r.cancellation_reason AS "cancellationReason",
       r.delivery_status AS "deliveryStatus",
       r.delivered_at::text AS "deliveredAt",
       r.last_error AS "lastError",
       o.status AS "orderStatus",
       o.provider_payment_id AS "providerPaymentId",
       r.created_at::text AS "createdAt",
       r.updated_at::text AS "updatedAt"`,
    [receiptId, receiptUrl, receiptNumber, issuedAt.toISOString()],
  );

  const task = result.rows[0] ? normalizeTask(result.rows[0]) : null;
  if (!task) throw new Error("Задача НПД-чека не найдена или уже требует аннулирования.");

  if (task.customerEmail) {
    const delivery = await sendReceiptEmail(task);
    await recordDeliveryResult(task.id, delivery);
    return (await getNpdReceiptById(task.id)) ?? task;
  }

  logEvent("npd_receipt.issued", { receiptId: task.id, delivery: "not_required" });
  return task;
}

export async function markNpdReceiptCanceled(input: {
  receiptId: string | number;
  reason?: string | null;
  canceledAt?: string | Date | null;
}): Promise<NpdReceiptTask> {
  const pool = requirePool();
  const receiptId = normalizePositiveId(input.receiptId);
  const reason = normalizeOptionalText(input.reason, 300) ?? "Возврат средств";
  const canceledAt = normalizeDate(input.canceledAt) ?? new Date();

  const result = await pool.query<ReceiptRow>(
    `UPDATE npd_receipts r
     SET status = 'canceled',
         canceled_at = $2,
         cancellation_reason = $3,
         delivery_status = CASE WHEN customer_email IS NULL THEN 'not_required' ELSE 'pending' END,
         delivered_at = NULL,
         last_error = NULL
     FROM checkout_orders o
     WHERE r.id = $1
       AND r.checkout_order_id = o.id
       AND r.status IN ('cancellation_required', 'canceled')
     RETURNING
       r.id::text AS "id",
       r.checkout_order_id::text AS "checkoutOrderId",
       r.user_id::text AS "userId",
       r.status,
       r.amount_rub AS "amountRub",
       r.currency,
       r.customer_email AS "customerEmail",
       r.service_name AS "serviceName",
       r.payment_received_at::text AS "paymentReceivedAt",
       r.due_at::text AS "dueAt",
       r.receipt_url AS "receiptUrl",
       r.receipt_number AS "receiptNumber",
       r.issued_at::text AS "issuedAt",
       r.canceled_at::text AS "canceledAt",
       r.cancellation_reason AS "cancellationReason",
       r.delivery_status AS "deliveryStatus",
       r.delivered_at::text AS "deliveredAt",
       r.last_error AS "lastError",
       o.status AS "orderStatus",
       o.provider_payment_id AS "providerPaymentId",
       r.created_at::text AS "createdAt",
       r.updated_at::text AS "updatedAt"`,
    [receiptId, canceledAt.toISOString(), reason],
  );

  const task = result.rows[0] ? normalizeTask(result.rows[0]) : null;
  if (!task) throw new Error("Задача аннулирования НПД-чека не найдена.");

  if (task.customerEmail) {
    const delivery = await sendCancellationEmail(task);
    await recordDeliveryResult(task.id, delivery);
    return (await getNpdReceiptById(task.id)) ?? task;
  }

  logEvent("npd_receipt.canceled", { receiptId: task.id, delivery: "not_required" });
  return task;
}

export async function retryNpdReceiptDelivery(receiptIdValue: string | number): Promise<NpdReceiptTask> {
  const task = await getNpdReceiptById(normalizePositiveId(receiptIdValue));
  if (!task) throw new Error("Задача НПД-чека не найдена.");
  if (!task.customerEmail) throw new Error("У заказа отсутствует e-mail для отправки чека.");
  if (task.status !== "issued" && task.status !== "canceled") {
    throw new Error("Отправка доступна только для выданного или аннулированного чека.");
  }
  const delivery = task.status === "issued"
    ? await sendReceiptEmail(task)
    : await sendCancellationEmail(task);
  await recordDeliveryResult(task.id, delivery);
  return (await getNpdReceiptById(task.id)) ?? task;
}

async function getNpdReceiptById(receiptId: string): Promise<NpdReceiptTask | null> {
  const pool = requirePool();
  const result = await pool.query<ReceiptRow>(
    `SELECT
       r.id::text AS "id",
       r.checkout_order_id::text AS "checkoutOrderId",
       r.user_id::text AS "userId",
       r.status,
       r.amount_rub AS "amountRub",
       r.currency,
       r.customer_email AS "customerEmail",
       r.service_name AS "serviceName",
       r.payment_received_at::text AS "paymentReceivedAt",
       r.due_at::text AS "dueAt",
       r.receipt_url AS "receiptUrl",
       r.receipt_number AS "receiptNumber",
       r.issued_at::text AS "issuedAt",
       r.canceled_at::text AS "canceledAt",
       r.cancellation_reason AS "cancellationReason",
       r.delivery_status AS "deliveryStatus",
       r.delivered_at::text AS "deliveredAt",
       r.last_error AS "lastError",
       o.status AS "orderStatus",
       o.provider_payment_id AS "providerPaymentId",
       r.created_at::text AS "createdAt",
       r.updated_at::text AS "updatedAt"
     FROM npd_receipts r
     INNER JOIN checkout_orders o ON o.id = r.checkout_order_id
     WHERE r.id = $1`,
    [receiptId],
  );
  return result.rows[0] ? normalizeTask(result.rows[0]) : null;
}

async function recordDeliveryResult(receiptId: string, result: SendEmailResult): Promise<void> {
  const pool = requirePool();
  if (result.ok) {
    await pool.query(
      `UPDATE npd_receipts
       SET delivery_status = 'sent', delivered_at = NOW(), last_error = NULL
       WHERE id = $1`,
      [receiptId],
    );
    logEvent("npd_receipt.delivery_sent", { receiptId });
    return;
  }

  const reason = result.reason === "not_configured" ? "email_not_configured" : "email_send_failed";
  await pool.query(
    `UPDATE npd_receipts
     SET delivery_status = 'failed', delivered_at = NULL, last_error = $2
     WHERE id = $1`,
    [receiptId, reason],
  );
  logError("npd_receipt.delivery_failed", new Error(reason), { receiptId });
}

async function sendReceiptEmail(task: NpdReceiptTask): Promise<SendEmailResult> {
  const url = task.receiptUrl;
  if (!task.customerEmail || !url) return { ok: false, reason: "send_failed" };
  const amount = formatRub(task.amountRub);
  const safeUrl = escapeHtml(url);
  const safeService = escapeHtml(task.serviceName);
  return sendEmail({
    to: task.customerEmail,
    subject: "Чек НПД — Recruiter Radar",
    text: `Чек по заказу №${task.checkoutOrderId}\nУслуга: ${task.serviceName}\nСумма: ${amount}\nЧек: ${url}`,
    html: `<p>Чек по заказу №${escapeHtml(task.checkoutOrderId)}</p><p><strong>Услуга:</strong> ${safeService}<br><strong>Сумма:</strong> ${escapeHtml(amount)}</p><p><a href="${safeUrl}">Открыть чек в системе ФНС</a></p>`,
  });
}

async function sendCancellationEmail(task: NpdReceiptTask): Promise<SendEmailResult> {
  if (!task.customerEmail) return { ok: false, reason: "send_failed" };
  const amount = formatRub(task.amountRub);
  return sendEmail({
    to: task.customerEmail,
    subject: "Возврат и аннулирование чека — Recruiter Radar",
    text: `По заказу №${task.checkoutOrderId} выполнен полный возврат ${amount}. Чек НПД аннулирован с причиной «${task.cancellationReason ?? "Возврат средств"}».`,
    html: `<p>По заказу №${escapeHtml(task.checkoutOrderId)} выполнен полный возврат <strong>${escapeHtml(amount)}</strong>.</p><p>Чек НПД аннулирован с причиной «${escapeHtml(task.cancellationReason ?? "Возврат средств")}».</p>`,
  });
}

function normalizeTask(row: ReceiptRow): NpdReceiptTask {
  if (!NPD_RECEIPT_STATUSES.includes(row.status as NpdReceiptStatus)) {
    throw new Error(`Unknown NPD receipt status: ${row.status}`);
  }
  if (!["pending", "sent", "failed", "not_required"].includes(row.deliveryStatus)) {
    throw new Error(`Unknown NPD delivery status: ${row.deliveryStatus}`);
  }
  return {
    ...row,
    status: row.status as NpdReceiptStatus,
    deliveryStatus: row.deliveryStatus as NpdReceiptDeliveryStatus,
  };
}

function requirePool() {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is required for NPD receipt operations.");
  return pool;
}

function normalizePositiveId(value: string | number): string {
  const text = String(value).trim();
  if (!/^\d+$/.test(text) || text === "0") throw new Error("Некорректный идентификатор задачи НПД-чека.");
  return text;
}

function normalizeHttpsUrl(value: string): string {
  const text = value.trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error("Укажите корректную HTTPS-ссылку на чек из «Мой налог».");
  }
  if (url.protocol !== "https:") throw new Error("Ссылка на чек должна использовать HTTPS.");
  return url.toString();
}

function normalizeOptionalText(value: string | null | undefined, maxLength: number): string | null {
  const text = value?.trim() ?? "";
  if (!text) return null;
  if (text.length > maxLength) throw new Error(`Значение не должно превышать ${maxLength} символов.`);
  return text;
}

function normalizeDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Некорректная дата операции с чеком.");
  return date;
}

function formatRub(amountRub: number): string {
  return `${new Intl.NumberFormat("ru-RU").format(amountRub)} ₽`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
