import type {
  CheckoutOrderStatus,
  PaymentCheckoutSessionInput,
  PaymentCheckoutSessionResult,
  PaymentProviderAdapter,
  PaymentSyncResult,
  PaymentWebhookParseResult,
} from "./paymentsTypes";
import { normalizeOptionalText } from "./paymentsNormalize";

const YOOKASSA_API_URL = "https://api.yookassa.ru/v3";

type YooKassaAmount = {
  value?: unknown;
  currency?: unknown;
};

type YooKassaPayment = {
  id?: unknown;
  status?: unknown;
  paid?: unknown;
  amount?: YooKassaAmount;
  confirmation?: {
    confirmation_url?: unknown;
  };
  metadata?: Record<string, unknown>;
  created_at?: unknown;
  captured_at?: unknown;
  canceled_at?: unknown;
  cancellation_details?: {
    party?: unknown;
    reason?: unknown;
  };
  test?: unknown;
};

type YooKassaNotification = {
  type?: unknown;
  event?: unknown;
  object?: YooKassaPayment;
};

export type YooKassaPaymentSetupState = {
  checkoutConfigured: boolean;
  mode: "test" | "live" | null;
  webhookConfigured: boolean;
};

export function getYooKassaPaymentSetupState(): YooKassaPaymentSetupState {
  const configured = Boolean(getCredentials());
  const modeValue = normalizeOptionalText(process.env.YOOKASSA_MODE)?.toLowerCase();
  const mode = modeValue === "test" || modeValue === "live" ? modeValue : configured ? "live" : null;

  return {
    checkoutConfigured: configured,
    mode,
    webhookConfigured: normalizeOptionalText(process.env.YOOKASSA_WEBHOOK_URL) !== null,
  };
}

export function createYooKassaPaymentAdapter(): PaymentProviderAdapter {
  return {
    code: "yookassa",
    isConfigured() {
      return getCredentials() !== null;
    },
    async createCheckoutSession(
      input: PaymentCheckoutSessionInput,
    ): Promise<PaymentCheckoutSessionResult> {
      const credentials = getCredentials();
      if (!credentials) {
        return {
          kind: "unavailable",
          provider: "yookassa",
          message: "ЮKassa пока не настроена.",
        };
      }

      const payment = await yooKassaRequest<YooKassaPayment>("/payments", {
        method: "POST",
        credentials,
        idempotenceKey: buildIdempotenceKey("payment", input.order.id),
        body: {
          amount: {
            value: formatAmount(input.order.amountMinor),
            currency: input.order.currency,
          },
          capture: true,
          confirmation: {
            type: "redirect",
            return_url: input.successUrl,
          },
          description: buildDescription(input.order.id, input.order.payload.planName),
          metadata: {
            order_id: input.order.id,
            product_code: input.order.productCode,
          },
        },
      });

      const paymentId = readRequiredString(payment.id, "ЮKassa did not return a payment id.");
      const redirectUrl = readRequiredString(
        payment.confirmation?.confirmation_url,
        "ЮKassa did not return a confirmation URL.",
      );

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
      const credentials = getCredentials();
      if (!paymentId || !credentials) return null;

      const payment = await fetchPayment(paymentId, credentials);
      const orderId = readOptionalString(payment.metadata?.order_id);
      if (orderId && orderId !== order.id) {
        throw new Error("YooKassa payment metadata does not match the checkout order.");
      }

      return mapPaymentToSyncResult(payment);
    },
    async parseWebhook(request: Request): Promise<PaymentWebhookParseResult> {
      const credentials = getCredentials();
      if (!credentials) {
        return webhookError(503, "YooKassa is not configured.");
      }

      let notification: YooKassaNotification;
      try {
        notification = (await request.json()) as YooKassaNotification;
      } catch {
        return webhookError(400, "Invalid JSON.");
      }

      if (notification.type !== "notification") {
        return webhookError(400, "Invalid YooKassa notification type.");
      }

      const event = readOptionalString(notification.event);
      const paymentId = readOptionalString(notification.object?.id);
      if (!event || !paymentId) {
        return webhookError(400, "Missing YooKassa event or payment id.");
      }

      if (!event.startsWith("payment.")) {
        return {
          ok: true,
          responseStatus: 200,
          responseBody: "ignored",
        };
      }

      // YooKassa notifications do not use our private x-billing-secret header.
      // Verify every notification by loading the payment from YooKassa with our
      // own shop credentials and trust only the API response below.
      let payment: YooKassaPayment;
      try {
        payment = await fetchPayment(paymentId, credentials);
      } catch {
        return webhookError(502, "Unable to verify YooKassa payment.");
      }

      const orderId = readOptionalString(payment.metadata?.order_id);
      if (!orderId) {
        return webhookError(400, "YooKassa payment has no order_id metadata.");
      }

      const sync = mapPaymentToSyncResult(payment);
      return {
        ok: true,
        responseStatus: 200,
        responseBody: "ok",
        orderId,
        providerPaymentId: paymentId,
        status: sync.status,
        paidAt: sync.paidAt,
        payload: sync.payload,
        message: sync.message,
      };
    },
  };
}

function getCredentials(): { shopId: string; secretKey: string } | null {
  const shopId = normalizeOptionalText(process.env.YOOKASSA_SHOP_ID);
  const secretKey = normalizeOptionalText(process.env.YOOKASSA_SECRET_KEY);
  return shopId && secretKey ? { shopId, secretKey } : null;
}

async function fetchPayment(
  paymentId: string,
  credentials: { shopId: string; secretKey: string },
): Promise<YooKassaPayment> {
  return yooKassaRequest<YooKassaPayment>(`/payments/${encodeURIComponent(paymentId)}`, {
    method: "GET",
    credentials,
  });
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
  const headers: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(`${options.credentials.shopId}:${options.credentials.secretKey}`).toString("base64")}`,
    Accept: "application/json",
  };

  if (options.body) headers["Content-Type"] = "application/json";
  if (options.idempotenceKey) headers["Idempotence-Key"] = options.idempotenceKey;

  const response = await fetch(`${YOOKASSA_API_URL}${path}`, {
    method: options.method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const description = readErrorDescription(data) ?? `HTTP ${response.status}`;
    throw new Error(`YooKassa API error: ${description}`);
  }

  return data as T;
}

function mapPaymentToSyncResult(payment: YooKassaPayment): PaymentSyncResult {
  const providerPaymentId = readOptionalString(payment.id);
  const status = mapStatus(payment.status);
  const cancellationReason = readOptionalString(payment.cancellation_details?.reason);

  return {
    status,
    providerPaymentId,
    paidAt:
      status === "paid"
        ? readOptionalString(payment.captured_at) ?? new Date().toISOString()
        : null,
    payload: buildSafePayload(payment),
    message:
      status === "canceled"
        ? cancellationReason
          ? `Платёж отменён: ${cancellationReason}.`
          : "Платёж отменён."
        : null,
  };
}

function mapStatus(value: unknown): CheckoutOrderStatus {
  switch (readOptionalString(value)) {
    case "succeeded":
      return "paid";
    case "canceled":
      return "canceled";
    case "pending":
    case "waiting_for_capture":
      return "pending";
    default:
      return "failed";
  }
}

function buildSafePayload(payment: YooKassaPayment): Record<string, unknown> {
  return {
    id: readOptionalString(payment.id),
    status: readOptionalString(payment.status),
    paid: payment.paid === true,
    amount: {
      value: readOptionalString(payment.amount?.value),
      currency: readOptionalString(payment.amount?.currency),
    },
    createdAt: readOptionalString(payment.created_at),
    capturedAt: readOptionalString(payment.captured_at),
    canceledAt: readOptionalString(payment.canceled_at),
    test: payment.test === true,
    cancellation: payment.cancellation_details
      ? {
          party: readOptionalString(payment.cancellation_details.party),
          reason: readOptionalString(payment.cancellation_details.reason),
        }
      : null,
  };
}

function buildIdempotenceKey(kind: string, orderId: string): string {
  return `rr-${kind}-${orderId}`.slice(0, 64);
}

function buildDescription(orderId: string, planName: string): string {
  return `Recruiter Radar — ${planName}, заказ ${orderId}`.slice(0, 128);
}

function formatAmount(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error("Invalid checkout amount.");
  }
  return (amountMinor / 100).toFixed(2);
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
  return {
    ok: false,
    responseStatus: status,
    responseBody: body,
  };
}
