import { createHash, timingSafeEqual } from "node:crypto";

import type {
  CheckoutOrder,
  PaymentCheckoutSessionInput,
  PaymentCheckoutSessionResult,
  PaymentProviderAdapter,
  PaymentSyncResult,
  PaymentWebhookParseResult,
} from "./paymentsTypes";

const PAYMENT_URL = "https://auth.robokassa.ru/Merchant/Index.aspx";
const OP_STATE_URL = "https://auth.robokassa.ru/Merchant/WebService/Service.asmx/OpStateExt";
const REQUEST_TIMEOUT_MS = 10_000;
const SUPPORTED_HASHES = new Set(["md5", "sha256", "sha384", "sha512"]);

export type RobokassaPaymentSetupState = {
  checkoutConfigured: boolean;
  mode: "test" | "live" | null;
  webhookConfigured: boolean;
};

type RobokassaMode = "test" | "live";
type RobokassaConfig = {
  mode: RobokassaMode;
  merchantLogin: string;
  password1: string;
  password2: string;
  hashAlgorithm: "md5" | "sha256" | "sha384" | "sha512";
  resultUrl: string;
};

type OperationState = {
  resultCode: number;
  stateCode: number | null;
  stateDate: string | null;
  outSum: string | null;
  opKey: string | null;
  paymentMethod: string | null;
};

export function getRobokassaPaymentSetupState(): RobokassaPaymentSetupState {
  const mode = readMode();
  const config = mode ? readConfig(mode) : null;

  return {
    checkoutConfigured: config !== null,
    mode,
    webhookConfigured: Boolean(config?.resultUrl),
  };
}

export function createRobokassaPaymentAdapter(): PaymentProviderAdapter {
  return {
    code: "robokassa",
    isConfigured() {
      return readSelectedConfig() !== null;
    },
    async createCheckoutSession(input: PaymentCheckoutSessionInput): Promise<PaymentCheckoutSessionResult> {
      const config = readSelectedConfig();
      if (!config) {
        return {
          kind: "unavailable",
          provider: "robokassa",
          message: "Robokassa пока не настроена.",
        };
      }

      const invId = normalizeInvoiceId(input.order.id);
      const outSum = formatMinorAmount(input.order.amountMinor);
      const successUrl2 = normalizeReturnUrl(input.successUrl);
      const failUrl2 = normalizeReturnUrl(input.cancelUrl);
      const shp = {
        Shp_order_id: input.order.id,
        Shp_plan: input.order.productCode,
      };
      const modifiers = [
        encodeURIComponent(successUrl2),
        "GET",
        encodeURIComponent(failUrl2),
        "GET",
      ];
      const signatureBase = [
        config.merchantLogin,
        outSum,
        invId,
        ...modifiers,
        config.password1,
        ...serializeShp(shp),
      ].join(":");
      const signatureValue = digest(signatureBase, config.hashAlgorithm);

      const params = new URLSearchParams({
        MerchantLogin: config.merchantLogin,
        OutSum: outSum,
        InvId: invId,
        Description: buildDescription(input.order),
        SignatureValue: signatureValue,
        Culture: "ru",
        Encoding: "utf-8",
        Email: input.order.customerContact ?? "",
        SuccessUrl2: successUrl2,
        SuccessUrl2Method: "GET",
        FailUrl2: failUrl2,
        FailUrl2Method: "GET",
        ...shp,
      });
      if (config.mode === "test") params.set("IsTest", "1");

      return {
        kind: "redirect",
        provider: "robokassa",
        providerPaymentId: `robokassa:${invId}`,
        redirectUrl: `${PAYMENT_URL}?${params.toString()}`,
        payload: {
          mode: config.mode,
          invId,
          outSum,
          currency: input.order.currency,
          hashAlgorithm: config.hashAlgorithm,
          resultUrl: config.resultUrl,
        },
      };
    },
    async syncOrderAfterReturn(input): Promise<PaymentSyncResult | null> {
      if (input.order.status === "paid" || input.order.status === "refunded") return null;

      const config = readSelectedConfig();
      if (!config) return null;

      const returnedInvId = readSearchParam(input.searchParams?.InvId ?? input.searchParams?.invId);
      if (returnedInvId && returnedInvId !== input.order.id) {
        return {
          status: input.order.status,
          message: "Получен возврат от платёжной формы с другим номером заказа.",
        };
      }

      if (config.mode === "test") {
        return {
          status: "pending",
          message: "Тестовый платёж ожидает подтверждения ResultURL от Robokassa.",
        };
      }

      const operation = await fetchOperationState(config, input.order.id);
      if (operation.resultCode !== 0) {
        return {
          status: "pending",
          message: `Robokassa пока не подтвердила операцию (${operation.resultCode}).`,
        };
      }
      if (operation.stateCode === 10 || operation.stateCode === 60) {
        return {
          status: "canceled",
          providerPaymentId: operation.opKey ?? input.providerPaymentId ?? null,
          payload: buildOperationPayload(config, operation),
          message: "Платёж отменён или средства возвращены платёжным оператором.",
        };
      }
      if (operation.stateCode !== 100 || !operation.outSum) {
        return {
          status: "pending",
          providerPaymentId: operation.opKey ?? input.providerPaymentId ?? null,
          payload: buildOperationPayload(config, operation),
          message: "Платёж обрабатывается. Доступ включится после серверного подтверждения.",
        };
      }
      if (parseAmountMinor(operation.outSum) !== input.order.amountMinor) {
        throw new Error("Robokassa operation amount does not match checkout order.");
      }

      return {
        status: "paid",
        providerPaymentId: operation.opKey ?? input.providerPaymentId ?? `robokassa:${input.order.id}`,
        paidAt: normalizeDate(operation.stateDate) ?? new Date().toISOString(),
        payload: buildOperationPayload(config, operation),
        message: null,
      };
    },
    async parseWebhook(request: Request): Promise<PaymentWebhookParseResult> {
      const config = readSelectedConfig();
      if (!config) return rejectWebhook(503, "Robokassa is not configured.");

      let params: URLSearchParams;
      try {
        params = await readRequestParams(request);
      } catch {
        return rejectWebhook(400, "Invalid Robokassa notification.");
      }

      const outSum = params.get("OutSum")?.trim() ?? "";
      const invId = params.get("InvId")?.trim() ?? params.get("InvID")?.trim() ?? "";
      const signatureValue = params.get("SignatureValue")?.trim() ?? "";
      const shp = Object.fromEntries(
        [...params.entries()].filter(([key]) => key.startsWith("Shp_")),
      );

      if (!outSum || !invId || !signatureValue) {
        return rejectWebhook(400, "Required Robokassa parameters are missing.");
      }

      try {
        normalizeInvoiceId(invId);
        parseAmountMinor(outSum);
      } catch {
        return rejectWebhook(400, "Invalid amount or invoice id.");
      }

      const expectedSignature = digest(
        [outSum, invId, config.password2, ...serializeShp(shp)].join(":"),
        config.hashAlgorithm,
      );
      if (!safeEqualHex(signatureValue, expectedSignature)) {
        return rejectWebhook(401, "Invalid Robokassa signature.");
      }

      if (shp.Shp_order_id && shp.Shp_order_id !== invId) {
        return rejectWebhook(409, "Robokassa order binding mismatch.");
      }

      let operation: OperationState | null = null;
      if (config.mode === "live") {
        try {
          operation = await fetchOperationState(config, invId);
        } catch {
          return rejectWebhook(503, "Robokassa operation verification is temporarily unavailable.");
        }
        if (operation.resultCode !== 0 || operation.stateCode !== 100 || !operation.outSum) {
          return rejectWebhook(409, "Robokassa operation is not in the paid state.");
        }
        if (parseAmountMinor(operation.outSum) !== parseAmountMinor(outSum)) {
          return rejectWebhook(409, "Robokassa callback amount does not match operation state.");
        }
      }

      const payload = {
        mode: config.mode,
        signatureVerified: true,
        amount: { value: outSum, currency: "RUB" },
        invId,
        fee: params.get("Fee"),
        email: params.get("EMail"),
        paymentMethod: operation?.paymentMethod ?? params.get("PaymentMethod"),
        incCurrLabel: params.get("IncCurrLabel"),
        opKey: operation?.opKey ?? null,
        stateCode: operation?.stateCode ?? 100,
        shp,
      };

      return {
        ok: true,
        responseStatus: 200,
        responseBody: `OK${invId}`,
        orderId: invId,
        providerPaymentId: operation?.opKey ?? `robokassa:${config.mode}:${invId}`,
        status: "paid",
        paidAt: normalizeDate(operation?.stateDate ?? null) ?? new Date().toISOString(),
        payload,
        message: null,
      };
    },
  };
}

function readSelectedConfig(): RobokassaConfig | null {
  const mode = readMode();
  return mode ? readConfig(mode) : null;
}

function readMode(): RobokassaMode | null {
  const value = process.env.ROBOKASSA_MODE?.trim().toLowerCase();
  return value === "test" || value === "live" ? value : null;
}

function readConfig(mode: RobokassaMode): RobokassaConfig | null {
  const merchantLogin = process.env.ROBOKASSA_MERCHANT_LOGIN?.trim() ?? "";
  const password1 = (
    mode === "test"
      ? process.env.ROBOKASSA_TEST_PASSWORD_1 ?? process.env.ROBOKASSA_PASSWORD_1
      : process.env.ROBOKASSA_PASSWORD_1
  )?.trim() ?? "";
  const password2 = (
    mode === "test"
      ? process.env.ROBOKASSA_TEST_PASSWORD_2 ?? process.env.ROBOKASSA_PASSWORD_2
      : process.env.ROBOKASSA_PASSWORD_2
  )?.trim() ?? "";
  const hashAlgorithmValue = process.env.ROBOKASSA_HASH_ALGORITHM?.trim().toLowerCase() ?? "md5";
  const resultUrl = process.env.ROBOKASSA_RESULT_URL?.trim() ?? "";

  if (!merchantLogin || !password1 || !password2 || !resultUrl || !SUPPORTED_HASHES.has(hashAlgorithmValue)) {
    return null;
  }

  try {
    const url = new URL(resultUrl);
    if (url.protocol !== "https:" && process.env.NODE_ENV === "production") return null;
  } catch {
    return null;
  }

  return {
    mode,
    merchantLogin,
    password1,
    password2,
    hashAlgorithm: hashAlgorithmValue as RobokassaConfig["hashAlgorithm"],
    resultUrl,
  };
}

async function readRequestParams(request: Request): Promise<URLSearchParams> {
  if (request.method.toUpperCase() === "GET") return new URL(request.url).searchParams;
  const text = await request.text();
  return new URLSearchParams(text);
}

async function fetchOperationState(config: RobokassaConfig, invId: string): Promise<OperationState> {
  const signature = digest(
    `${config.merchantLogin}:${normalizeInvoiceId(invId)}:${config.password2}`,
    config.hashAlgorithm,
  );
  const url = new URL(OP_STATE_URL);
  url.searchParams.set("MerchantLogin", config.merchantLogin);
  url.searchParams.set("InvoiceID", normalizeInvoiceId(invId));
  url.searchParams.set("Signature", signature);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`Robokassa OpStateExt HTTP ${response.status}`);
    const xml = await response.text();
    return {
      resultCode: Number(readXmlTag(xml, "Result", "Code") ?? "1000"),
      stateCode: toNullableNumber(readXmlTag(xml, "State", "Code")),
      stateDate: readXmlTag(xml, "State", "StateDate"),
      outSum: readXmlTag(xml, "Info", "OutSum"),
      opKey: readXmlTag(xml, "Info", "OpKey"),
      paymentMethod: readXmlTag(xml, "PaymentMethod", "Code"),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function readXmlTag(xml: string, parent: string, child: string): string | null {
  const parentMatch = xml.match(new RegExp(`<${parent}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${parent}>`, "i"));
  if (!parentMatch) return null;
  const childMatch = parentMatch[1].match(new RegExp(`<${child}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${child}>`, "i"));
  return childMatch ? decodeXml(childMatch[1].trim()) : null;
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function buildOperationPayload(config: RobokassaConfig, operation: OperationState): Record<string, unknown> {
  return {
    mode: config.mode,
    verifiedBy: "OpStateExt",
    amount: operation.outSum ? { value: operation.outSum, currency: "RUB" } : null,
    opKey: operation.opKey,
    stateCode: operation.stateCode,
    stateDate: operation.stateDate,
    paymentMethod: operation.paymentMethod,
  };
}

function buildDescription(order: CheckoutOrder): string {
  return `Recruiter Radar — ${order.payload.planName}, ${order.payload.planCadence}`.slice(0, 100);
}

function serializeShp(shp: Record<string, string>): string[] {
  return Object.entries(shp)
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([key, value]) => `${key}=${value}`);
}

function normalizeInvoiceId(value: string): string {
  if (!/^\d+$/.test(value)) throw new Error("Robokassa InvId must be an integer.");
  const numeric = BigInt(value);
  if (numeric <= 0n || numeric > 2_147_483_647n) throw new Error("Robokassa InvId is out of range.");
  return numeric.toString();
}

function formatMinorAmount(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Error("Invalid checkout amount.");
  return `${Math.floor(amountMinor / 100)}.${String(amountMinor % 100).padStart(2, "0")}`;
}

function parseAmountMinor(value: string): number {
  const match = value.trim().match(/^(\d+)(?:\.(\d{1,6}))?$/);
  if (!match) throw new Error("Invalid Robokassa amount.");
  const fractional = (match[2] ?? "").padEnd(6, "0");
  if (fractional.slice(2).replace(/0/g, "") !== "") throw new Error("Robokassa amount has sub-kopeck precision.");
  const minor = Number(match[1]) * 100 + Number(fractional.slice(0, 2));
  if (!Number.isSafeInteger(minor) || minor <= 0) throw new Error("Invalid Robokassa amount.");
  return minor;
}

function normalizeReturnUrl(value: string): string {
  const url = new URL(value);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("Robokassa return URL must use HTTPS in production.");
  }
  return url.toString();
}

function digest(value: string, algorithm: RobokassaConfig["hashAlgorithm"]): string {
  return createHash(algorithm).update(value, "utf8").digest("hex");
}

function safeEqualHex(left: string, right: string): boolean {
  const a = Buffer.from(left.toLowerCase(), "utf8");
  const b = Buffer.from(right.toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function normalizeDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toNullableNumber(value: string | null): number | null {
  if (value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readSearchParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0]?.trim() || null;
  return value?.trim() || null;
}

function rejectWebhook(responseStatus: number, responseBody: string): PaymentWebhookParseResult {
  return { ok: false, responseStatus, responseBody };
}
