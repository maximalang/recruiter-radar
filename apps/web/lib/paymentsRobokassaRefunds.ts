import { createHmac } from "node:crypto";

const CREATE_REFUND_URL = "https://services.robokassa.ru/RefundService/Refund/Create";
const REFUND_STATE_URL = "https://services.robokassa.ru/RefundService/Refund/GetState";
const REQUEST_TIMEOUT_MS = 10_000;

const REFUND_ALGORITHMS = {
  HS256: "sha256",
  HS384: "sha384",
  HS512: "sha512",
} as const;

type RefundJwtAlgorithm = keyof typeof REFUND_ALGORITHMS;

type RefundConfig = {
  password3: string;
  algorithm: RefundJwtAlgorithm;
};

export type CreateRobokassaRefundInput = {
  opKey: string;
  orderAmountMinor: number;
  /** Omit for a full refund. */
  amountMinor?: number | null;
};

export type CreateRobokassaRefundResult =
  | {
      ok: true;
      requestId: string;
      amountMinor: number;
      full: boolean;
      providerPayload: Record<string, unknown>;
    }
  | {
      ok: false;
      message: string;
    };

export type RobokassaRefundState = {
  requestId: string;
  label: string;
  amountMinor: number | null;
  finished: boolean;
  failed: boolean;
  message: string | null;
};

export function getRobokassaRefundSetupState(): {
  configured: boolean;
  mode: "live" | "test" | null;
  algorithm: RefundJwtAlgorithm | null;
} {
  const modeValue = process.env.ROBOKASSA_MODE?.trim().toLowerCase();
  const mode = modeValue === "live" || modeValue === "test" ? modeValue : null;
  const config = readRefundConfig();
  return {
    configured: mode === "live" && config !== null,
    mode,
    algorithm: config?.algorithm ?? null,
  };
}

export async function createRobokassaRefund(
  input: CreateRobokassaRefundInput,
): Promise<CreateRobokassaRefundResult> {
  const config = readRefundConfig();
  if (process.env.ROBOKASSA_MODE?.trim().toLowerCase() !== "live" || !config) {
    return {
      ok: false,
      message: "Refund API доступен только после настройки live-магазина и Password3.",
    };
  }

  const opKey = normalizeOpKey(input.opKey);
  const orderAmountMinor = normalizePositiveMinor(input.orderAmountMinor, "orderAmountMinor");
  const requestedAmountMinor = input.amountMinor == null
    ? orderAmountMinor
    : normalizePositiveMinor(input.amountMinor, "amountMinor");

  if (requestedAmountMinor > orderAmountMinor) {
    return { ok: false, message: "Сумма возврата превышает сумму заказа." };
  }

  const full = requestedAmountMinor === orderAmountMinor;
  const payload: Record<string, unknown> = { OpKey: opKey };
  if (!full) payload.RefundSum = minorToRubles(requestedAmountMinor);

  const token = createRefundJwt(payload, config);
  const response = await fetchJsonWithTimeout(CREATE_REFUND_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(token),
  });

  const success = response.success === true;
  const requestId = typeof response.requestId === "string" ? response.requestId.trim() : "";
  if (!success || !isUuid(requestId)) {
    return {
      ok: false,
      message: normalizeProviderMessage(response.message) ?? "Robokassa не создала заявку на возврат.",
    };
  }

  return {
    ok: true,
    requestId,
    amountMinor: requestedAmountMinor,
    full,
    providerPayload: {
      requestId,
      opKey,
      amount: { value: formatMinor(requestedAmountMinor), currency: "RUB" },
      full,
      jwtAlgorithm: config.algorithm,
      invoiceItemsSent: false,
    },
  };
}

export async function getRobokassaRefundState(requestIdValue: string): Promise<RobokassaRefundState> {
  const requestId = normalizeRequestId(requestIdValue);
  const url = new URL(REFUND_STATE_URL);
  url.searchParams.set("id", requestId);

  const response = await fetchJsonWithTimeout(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  const label = typeof response.label === "string" ? response.label.trim().toLowerCase() : "";
  const amountMinor = response.amount == null ? null : parseRublesToMinor(response.amount);
  const message = normalizeProviderMessage(response.message);
  const failed = Boolean(message) || ["failed", "error", "rejected", "cancelled", "canceled"].includes(label);

  return {
    requestId,
    label: label || (failed ? "failed" : "processing"),
    amountMinor,
    finished: label === "finished",
    failed,
    message,
  };
}

function readRefundConfig(): RefundConfig | null {
  const password3 = process.env.ROBOKASSA_PASSWORD_3?.trim() ?? "";
  const requestedAlgorithm = process.env.ROBOKASSA_REFUND_JWT_ALGORITHM?.trim().toUpperCase() || "HS256";
  if (!password3 || !(requestedAlgorithm in REFUND_ALGORITHMS)) return null;
  return {
    password3,
    algorithm: requestedAlgorithm as RefundJwtAlgorithm,
  };
}

function createRefundJwt(payload: Record<string, unknown>, config: RefundConfig): string {
  const header = { alg: config.algorithm, typ: "JWT" };
  const encodedHeader = encodeJwtPart(header);
  const encodedPayload = encodeJwtPart(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac(REFUND_ALGORITHMS[config.algorithm], config.password3)
    .update(signingInput, "utf8")
    .digest("base64url");
  return `${signingInput}.${signature}`;
}

function encodeJwtPart(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await response.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`Robokassa Refund API returned invalid JSON (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      const message = payload && typeof payload === "object"
        ? normalizeProviderMessage((payload as Record<string, unknown>).message)
        : null;
      throw new Error(message ?? `Robokassa Refund API HTTP ${response.status}.`);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Robokassa Refund API returned an invalid payload.");
    }
    return payload as Record<string, unknown>;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeOpKey(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9-]{16,160}$/.test(normalized)) {
    throw new Error("Invalid Robokassa OpKey.");
  }
  return normalized;
}

function normalizeRequestId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!isUuid(normalized)) throw new Error("Invalid Robokassa refund request id.");
  return normalized;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizePositiveMinor(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer amount in kopecks.`);
  }
  return value;
}

function minorToRubles(value: number): number {
  return Number(formatMinor(value));
}

function formatMinor(value: number): string {
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}

function parseRublesToMinor(value: unknown): number | null {
  const normalized = typeof value === "number" || typeof value === "string" ? String(value).trim() : "";
  const match = normalized.match(/^(\d+)(?:\.(\d{1,6}))?$/);
  if (!match) return null;
  const fractional = (match[2] ?? "").padEnd(6, "0");
  if (fractional.slice(2).replace(/0/g, "") !== "") return null;
  const minor = Number(match[1]) * 100 + Number(fractional.slice(0, 2));
  return Number.isSafeInteger(minor) ? minor : null;
}

function normalizeProviderMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 500) : null;
}
