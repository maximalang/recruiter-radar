import type {
  CheckoutOrder,
  CheckoutOrderStatus,
  PaymentCheckoutSessionInput,
  PaymentCheckoutSessionResult,
  PaymentProviderAdapter,
  PaymentSyncResult,
  PaymentWebhookParseResult,
} from "./paymentsTypes";
import { normalizeOptionalText } from "./paymentsNormalize";

const YOOKASSA_API_URL = "https://api.yookassa.ru/v3";
const CANONICAL_SITE_URL = "https://recruiter-radar.ru";
const REQUEST_TIMEOUT_MS = 10_000;

type YooKassaAmount = { value?: unknown; currency?: unknown };
type YooKassaPayment = {
  id?: unknown;
  status?: unknown;
  paid?: unknown;
  amount?: YooKassaAmount;
  refunded_amount?: YooKassaAmount;
  confirmation?: { confirmation_url?: unknown };
  metadata?: Record<string, unknown>;
  created_at?: unknown;
  captured_at?: unknown;
  canceled_at?: unknown;
  cancellation_details?: { party?: unknown; reason?: unknown };
  test?: unknown;
};
type YooKassaRefund = {
  id?: unknown;
  status?: unknown;
  amount?: YooKassaAmount;
  payment_id?: unknown;
  created_at?: unknown;
};
type YooKassaNotification = {
  type?: unknown;
  event?: unknown;
  object?: { id?: unknown };
};

export type YooKassaPaymentSetupState = {
  checkoutConfigured: boolean;
  mode: "test" | "live" | null;
  webhookConfigured: boolean;
  siteUrlConfigured: boolean;
};

export function getYooKassaPaymentSetupState(): YooKassaPaymentSetupState {
  const mode = getMode();
  const siteUrlConfigured = normalizeUrl(process.env.PAYMENTS_SITE_URL) === CANONICAL_SITE_URL;
  const webhookConfigured = normalizeUrl(process.env.YOOKASSA_WEBHOOK_URL) === `${CANONICAL_SITE_URL}/api/billing/webhook/yookassa`;
  return {
    checkoutConfigured: Boolean(getCredentials() && mode && siteUrlConfigured && webhookConfigured),
    mode,
    webhookConfigured,
    siteUrlConfigured,
  };
}

export function createYooKassaPaymentAdapter(): PaymentProviderAdapter {
  return {
    code: "yookassa",
    isConfigured() {
      return getYooKassaPaymentSetupState().checkoutConfigured;
    },
    async createCheckoutSession(input: PaymentCheckoutSessionInput): Promise<PaymentCheckoutSessionResult> {
      const setup = getRuntimeSetup();
      if (!setup) return unavailable();

      const payment = await yooKassaRequest<YooKassaPayment>("/payments", {
        method: "POST",
        credentials: setup.credentials,
        idempotenceKey: buildIdempotenceKey("payment", input.order.id),
        body: {
          amount: { value: formatAmount(input.order.amountMinor), currency: input.order.currency },
          capture: true,
          confirmation: { type: "redirect", return_url: input.successUrl },
          description: buildDescription(input.order.id, input.order.payload.planName),
          metadata: {
            order_id: input.order.id,
            product_code: input.order.productCode,
            amount_minor: String(input.order.amountMinor),
            currency: input.order.currency,
          },
        },
      });

      assertPaymentMatchesOrder(payment, input.order, setup.mode);
      const paymentId = readRequiredString(payment.id, "ЮKassa не вернула идентификатор платежа.");
      const redirectUrl = readRequiredString(payment.confirmation?.confirmation_url, "ЮKassa не вернула ссылку на оплату.");

      return {
        kind: "redirect",
        provider: "yookassa",
        providerPaymentId: paymentId,
        redirectUrl,
        payload: buildSafePayload(payment),
      };
    },
    async syncOrderAfterReturn({ order, providerPaymentId }): Promise<PaymentSyncResult | null> {
      const paymentId = normalizeOptionalText(providerPaymentId);
      const setup = getRuntimeSetup();
      if (!paymentId || !setup) return null;
      if (order.providerPaymentId && order.providerPaymentId !== paymentId) {
        throw new Error("Идентификатор платежа ЮKassa не совпадает с заказом.");
      }
      const payment = await fetchPayment(paymentId, setup.credentials);
      assertPaymentMatchesOrder(payment, order, setup.mode);
      return mapPaymentToSyncResult(payment);
    },
    async parseWebhook(request: Request): Promise<PaymentWebhookParseResult> {
      const setup = getRuntimeSetup();
      if (!setup) return webhookError(503, "ЮKassa не настроена полностью.");

      let notification: YooKassaNotification;
      try {
        notification = (await request.json()) as YooKassaNotification;
      } catch {
        return webhookError(400, "Некорректный JSON.");
      }

      if (notification.type !== "notification") return webhookError(400, "Некорректный тип уведомления.");
      const event = readOptionalString(notification.event);
      const objectId = readOptionalString(notification.object?.id);
      if (!event || !objectId) return webhookError(400, "Не указан event или object.id.");

      if (event === "refund.succeeded") {
        let refund: YooKassaRefund;
        let payment: YooKassaPayment;
        try {
          refund = await fetchRefund(objectId, setup.credentials);
          if (readOptionalString(refund.status) !== "succeeded") return webhookError(409, "Возврат ещё не завершён.");
          const paymentId = readRequiredString(refund.payment_id, "У возврата отсутствует payment_id.");
          payment = await fetchPayment(paymentId, setup.credentials);
        } catch {
          return webhookError(502, "Не удалось проверить возврат через API ЮKassa.");
        }
        if (!isModeMatch(payment, setup.mode)) return webhookError(409, "Режим платежа не совпадает с конфигурацией.");
        const orderId = readOptionalString(payment.metadata?.order_id);
        if (!orderId) return webhookError(400, "У платежа отсутствует order_id.");
        assertMetadataIntegrity(payment);
        const sync = mapPaymentToSyncResult(payment, refund);
        return {
          ok: true,
          responseStatus: 200,
          responseBody: "ok",
          orderId,
          providerPaymentId: readOptionalString(payment.id),
          status: sync.status,
          paidAt: sync.paidAt,
          amountMinor: sync.amountMinor,
          currency: sync.currency,
          test: sync.test,
          payload: sync.payload,
          message: sync.message,
        };
      }

      if (!event.startsWith("payment.")) {
        return { ok: true, responseStatus: 200, responseBody: "ignored" };
      }

      let payment: YooKassaPayment;
      try {
        payment = await fetchPayment(objectId, setup.credentials);
      } catch {
        return webhookError(502, "Не удалось проверить платеж через API ЮKassa.");
      }
      if (!isModeMatch(payment, setup.mode)) return webhookError(409, "Режим платежа не совпадает с конфигурацией.");
      const orderId = readOptionalString(payment.metadata?.order_id);
      if (!orderId) return webhookError(400, "У платежа отсутствует order_id.");
      assertMetadataIntegrity(payment);
      const sync = mapPaymentToSyncResult(payment);
      return {
        ok: true,
        responseStatus: 200,
        responseBody: "ok",
        orderId,
        providerPaymentId: readOptionalString(payment.id),
        status: sync.status,
        paidAt: sync.paidAt,
        amountMinor: sync.amountMinor,
        currency: sync.currency,
        test: sync.test,
        payload: sync.payload,
        message: sync.message,
      };
    },
  };
}

function getRuntimeSetup(): { credentials: { shopId: string; secretKey: string }; mode: "test" | "live" } | null {
  const setup = getYooKassaPaymentSetupState();
  const credentials = getCredentials();
  return setup.checkoutConfigured && credentials && setup.mode ? { credentials, mode: setup.mode } : null;
}

function unavailable(): PaymentCheckoutSessionResult {
  return { kind: "unavailable", provider: "yookassa", message: "Оплата через ЮKassa пока не настроена полностью." };
}

function getCredentials(): { shopId: string; secretKey: string } | null {
  const shopId = normalizeOptionalText(process.env.YOOKASSA_SHOP_ID);
  const secretKey = normalizeOptionalText(process.env.YOOKASSA_SECRET_KEY);
  return shopId && secretKey ? { shopId, secretKey } : null;
}

function getMode(): "test" | "live" | null {
  const mode = normalizeOptionalText(process.env.YOOKASSA_MODE)?.toLowerCase();
  return mode === "test" || mode === "live" ? mode : null;
}

function normalizeUrl(value: string | undefined): string | null {
  const normalized = normalizeOptionalText(value)?.replace(/\/+$/, "") ?? null;
  if (!normalized) return null;
  try {
    return new URL(normalized).toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

async function fetchPayment(paymentId: string, credentials: { shopId: string; secretKey: string }): Promise<YooKassaPayment> {
  return yooKassaRequest<YooKassaPayment>(`/payments/${encodeURIComponent(paymentId)}`, { method: "GET", credentials });
}

async function fetchRefund(refundId: string, credentials: { shopId: string; secretKey: string }): Promise<YooKassaRefund> {
  return yooKassaRequest<YooKassaRefund>(`/refunds/${encodeURIComponent(refundId)}`, { method: "GET", credentials });
}

async function yooKassaRequest<T>(
  path: string,
  options: {
    method: "GET" | "POST";
    credentials: { shopId: string; secretKey: string };
    idempotenceKey?: string;
    body?: Record<string, unknown>;
  },
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(`${options.credentials.shopId}:${options.credentials.secretKey}`).toString("base64")}`,
    Accept: "application/json",
  };
  if (options.body) headers["Content-Type"] = "application/json";
  if (options.idempotenceKey) headers["Idempotence-Key"] = options.idempotenceKey;

  try {
    const response = await fetch(`${YOOKASSA_API_URL}${path}`, {
      method: options.method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) {
      const description = readErrorDescription(data) ?? `HTTP ${response.status}`;
      throw new Error(`Ошибка API ЮKassa: ${description}`);
    }
    return data as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("ЮKassa не ответила вовремя.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function assertPaymentMatchesOrder(payment: YooKassaPayment, order: CheckoutOrder, mode: "test" | "live"): void {
  const paymentId = readOptionalString(payment.id);
  if (order.providerPaymentId && paymentId !== order.providerPaymentId) throw new Error("Платёж ЮKassa не принадлежит заказу.");
  if (readOptionalString(payment.metadata?.order_id) !== order.id) throw new Error("order_id платежа ЮKassa не совпадает с заказом.");
  if (readAmountMinor(payment.amount) !== order.amountMinor) throw new Error("Сумма платежа ЮKassa не совпадает с заказом.");
  if (readOptionalString(payment.amount?.currency)?.toUpperCase() !== order.currency.toUpperCase()) throw new Error("Валюта платежа ЮKassa не совпадает с заказом.");
  if (!isModeMatch(payment, mode)) throw new Error("Test/live режим платежа ЮKassa не совпадает с конфигурацией.");
  assertMetadataIntegrity(payment);
}

function assertMetadataIntegrity(payment: YooKassaPayment): void {
  const expectedMinor = Number(readOptionalString(payment.metadata?.amount_minor));
  const actualMinor = readAmountMinor(payment.amount);
  if (!Number.isSafeInteger(expectedMinor) || expectedMinor <= 0 || expectedMinor !== actualMinor) {
    throw new Error("Сумма в metadata платежа ЮKassa не прошла проверку.");
  }
  const metadataCurrency = readOptionalString(payment.metadata?.currency)?.toUpperCase();
  const actualCurrency = readOptionalString(payment.amount?.currency)?.toUpperCase();
  if (!metadataCurrency || metadataCurrency !== actualCurrency) throw new Error("Валюта в metadata платежа ЮKassa не прошла проверку.");
}

function isModeMatch(payment: YooKassaPayment, mode: "test" | "live"): boolean {
  return payment.test === (mode === "test");
}

function mapPaymentToSyncResult(payment: YooKassaPayment, refund?: YooKassaRefund): PaymentSyncResult {
  const amountMinor = readAmountMinor(payment.amount);
  const refundedMinor = readAmountMinor(payment.refunded_amount, 0);
  const status = mapStatus(payment.status, refundedMinor >= amountMinor && amountMinor > 0);
  const cancellationReason = readOptionalString(payment.cancellation_details?.reason);
  return {
    status,
    providerPaymentId: readOptionalString(payment.id),
    paidAt: status === "paid" || status === "refunded" ? readOptionalString(payment.captured_at) : null,
    amountMinor,
    currency: readOptionalString(payment.amount?.currency),
    test: payment.test === true,
    payload: buildSafePayload(payment, refund),
    message:
      status === "refunded"
        ? "Платёж полностью возвращён. Доступ по заказу прекращён."
        : refund
          ? "Частичный возврат подтверждён. Остальной оплаченный доступ сохраняется."
          : status === "canceled"
            ? cancellationReason ? `Платёж отменён: ${cancellationReason}.` : "Платёж отменён."
            : null,
  };
}

function mapStatus(value: unknown, fullyRefunded: boolean): CheckoutOrderStatus {
  if (fullyRefunded) return "refunded";
  switch (readOptionalString(value)) {
    case "succeeded": return "paid";
    case "canceled": return "canceled";
    case "pending":
    case "waiting_for_capture": return "pending";
    default: return "failed";
  }
}

function buildSafePayload(payment: YooKassaPayment, refund?: YooKassaRefund): Record<string, unknown> {
  return {
    id: readOptionalString(payment.id),
    status: readOptionalString(payment.status),
    paid: payment.paid === true,
    amount: { value: readOptionalString(payment.amount?.value), currency: readOptionalString(payment.amount?.currency) },
    refundedAmount: { value: readOptionalString(payment.refunded_amount?.value), currency: readOptionalString(payment.refunded_amount?.currency) },
    createdAt: readOptionalString(payment.created_at),
    capturedAt: readOptionalString(payment.captured_at),
    canceledAt: readOptionalString(payment.canceled_at),
    test: payment.test === true,
    cancellation: payment.cancellation_details ? { party: readOptionalString(payment.cancellation_details.party), reason: readOptionalString(payment.cancellation_details.reason) } : null,
    refund: refund ? { id: readOptionalString(refund.id), status: readOptionalString(refund.status), amount: refund.amount, createdAt: readOptionalString(refund.created_at) } : null,
  };
}

function buildIdempotenceKey(kind: string, orderId: string): string {
  return `rr-${kind}-${orderId}`.slice(0, 64);
}
function buildDescription(orderId: string, planName: string): string {
  return `Recruiter Radar — ${planName}, заказ ${orderId}`.slice(0, 128);
}
function formatAmount(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Error("Некорректная сумма заказа.");
  return (amountMinor / 100).toFixed(2);
}
function readAmountMinor(amount: YooKassaAmount | undefined, fallback = -1): number {
  const value = readOptionalString(amount?.value);
  if (!value || !/^\d+(?:\.\d{1,2})?$/.test(value)) return fallback;
  const [rubles, kopecks = ""] = value.split(".");
  const minor = Number(rubles) * 100 + Number(kopecks.padEnd(2, "0"));
  return Number.isSafeInteger(minor) ? minor : fallback;
}
function readOptionalString(value: unknown): string | null {
  return typeof value === "string" ? normalizeOptionalText(value) : null;
}
function readRequiredString(value: unknown, message: string): string {
  const normalized = readOptionalString(value);
  if (!normalized) throw new Error(message);
  return normalized;
}
function readErrorDescription(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  return readOptionalString(candidate.description) ?? readOptionalString(candidate.code);
}
function webhookError(status: number, body: string): PaymentWebhookParseResult {
  return { ok: false, responseStatus: status, responseBody: body };
}
