import assert from "node:assert/strict";

const CANONICAL_ORIGIN = "https://recruiter-radar.ru";
const WEBHOOK_URL = `${CANONICAL_ORIGIN}/api/billing/webhook/yookassa`;
const EXPECTED_SUPPORT_EMAIL = "support@recruiter-radar.ru";
const EXPECTED_PHONE_DIGITS = "79009666092";
const EXPECTED_PILOT_AMOUNT = "2990.00";
const PUBLIC_PAGES = [
  { path: "/", includes: ["Recruiter Radar"] },
  { path: "/terms", includes: ["Публичная оферта", "ЮKassa", "возврат"] },
  { path: "/privacy", includes: ["персональных данных"] },
  { path: "/personal-data-consent", includes: ["Согласие на обработку персональных данных"] },
  { path: "/legal", includes: [EXPECTED_SUPPORT_EMAIL, "+7 900 966-60-92"] },
  { path: "/checkout?plan=pilot", includes: ["2 990", "ЮKassa"] },
];

const stage = readStage(process.argv.slice(2));
const networkEnabled = !process.argv.includes("--no-network");
const checks = [];

function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
}

function env(name) {
  return process.env[name]?.trim() ?? "";
}

function isIso(value) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

check("public_support_email", env("OPERATOR_PUBLIC_EMAIL") === EXPECTED_SUPPORT_EMAIL, "OPERATOR_PUBLIC_EMAIL");
check("public_phone", env("OPERATOR_PUBLIC_PHONE").replace(/\D/g, "") === EXPECTED_PHONE_DIGITS, "OPERATOR_PUBLIC_PHONE");
check("public_postal_address", env("OPERATOR_PUBLIC_POSTAL_ADDRESS").length >= 10, "OPERATOR_PUBLIC_POSTAL_ADDRESS");
check("payment_provider", env("PAYMENTS_PROVIDER") === "yookassa", "PAYMENTS_PROVIDER=yookassa");
check("canonical_site_url", stripTrailingSlash(env("PAYMENTS_SITE_URL")) === CANONICAL_ORIGIN, `PAYMENTS_SITE_URL=${CANONICAL_ORIGIN}`);
check("canonical_webhook_url", stripTrailingSlash(env("YOOKASSA_WEBHOOK_URL")) === WEBHOOK_URL, `YOOKASSA_WEBHOOK_URL=${WEBHOOK_URL}`);
check("support_mail_delivery", Boolean(env("POSTBOX_FROM") || env("SMTP_FROM")), "POSTBOX_FROM or SMTP_FROM");
check("operator_access", Boolean(env("ADMIN_OPERATOR_PASSWORD") && env("SESSION_SECRET").length >= 32), "ADMIN_OPERATOR_PASSWORD + SESSION_SECRET");
check("readiness_api_auth", env("CRON_API_KEY").length >= 24, "CRON_API_KEY");

if (stage === "test" || stage === "live") {
  check("shop_id", /^\d+$/.test(env("YOOKASSA_SHOP_ID")), "YOOKASSA_SHOP_ID");
  check("secret_key", env("YOOKASSA_SECRET_KEY").length >= 16, "YOOKASSA_SECRET_KEY");
  check("explicit_mode", env("YOOKASSA_MODE") === stage, `YOOKASSA_MODE=${stage}`);
}

if (stage === "live") {
  check("technical_verification", isIso(env("YOOKASSA_LAUNCH_VERIFIED_AT")), "YOOKASSA_LAUNCH_VERIFIED_AT");
  check("npd_verification", isIso(env("NPD_RECEIPT_FLOW_VERIFIED_AT")), "NPD_RECEIPT_FLOW_VERIFIED_AT");
  check("pdn_verification", isIso(env("PDN_COMPLIANCE_VERIFIED_AT")), "PDN_COMPLIANCE_VERIFIED_AT");
}

if (networkEnabled) {
  for (const page of PUBLIC_PAGES) {
    try {
      const response = await fetchWithTimeout(`${CANONICAL_ORIGIN}${page.path}`, { redirect: "follow" });
      const text = await response.text();
      const missing = page.includes.filter((fragment) => !text.includes(fragment));
      check(
        `public_page:${page.path}`,
        response.ok && missing.length === 0,
        response.ok ? (missing.length ? `missing: ${missing.join(", ")}` : `HTTP ${response.status}`) : `HTTP ${response.status}`,
      );
    } catch (error) {
      check(`public_page:${page.path}`, false, safeError(error));
    }
  }

  try {
    const response = await fetchWithTimeout(WEBHOOK_URL, { method: "GET", redirect: "manual" });
    check("public_webhook_route", response.status === 405, `HTTP ${response.status}; expected 405 for GET`);
  } catch (error) {
    check("public_webhook_route", false, safeError(error));
  }

  if ((stage === "test" || stage === "live") && env("YOOKASSA_VERIFICATION_PAYMENT_ID")) {
    try {
      const payment = await fetchYooKassaPayment(env("YOOKASSA_VERIFICATION_PAYMENT_ID"));
      check("verification_payment_mode", payment.test === (stage === "test"), `payment.test=${String(payment.test)}`);
      check("verification_payment_amount", payment.amount?.value === EXPECTED_PILOT_AMOUNT, `payment.amount=${String(payment.amount?.value)}`);
      check("verification_payment_currency", payment.amount?.currency === "RUB", `payment.currency=${String(payment.amount?.currency)}`);
      check("verification_payment_metadata", Boolean(payment.metadata?.order_id), "metadata.order_id");
    } catch (error) {
      check("verification_payment_api", false, safeError(error));
    }
  }

  if ((stage === "test" || stage === "live") && env("CRON_API_KEY")) {
    try {
      const response = await fetchWithTimeout(`${CANONICAL_ORIGIN}/api/health/payment-readiness`, {
        headers: { "x-api-key": env("CRON_API_KEY") },
      });
      const payload = await response.json();
      const expectedStatus = stage === "live" ? "live-ready" : "integration-ready";
      check("runtime_readiness", response.ok && payload?.status === expectedStatus, `status=${String(payload?.status)}`);
    } catch (error) {
      check("runtime_readiness", false, safeError(error));
    }
  }
}

const failed = checks.filter((item) => !item.ok);
const report = {
  ok: failed.length === 0,
  stage,
  networkEnabled,
  canonicalOrigin: CANONICAL_ORIGIN,
  checks,
  failed: failed.map(({ name, detail }) => ({ name, detail })),
};

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;

function readStage(args) {
  const arg = args.find((value) => value.startsWith("--stage="));
  const value = arg?.slice("--stage=".length) ?? "registration";
  assert.ok(["registration", "test", "live"].includes(value), "--stage must be registration, test or live");
  return value;
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchYooKassaPayment(paymentId) {
  const credentials = `${env("YOOKASSA_SHOP_ID")}:${env("YOOKASSA_SECRET_KEY")}`;
  const response = await fetchWithTimeout(
    `https://api.yookassa.ru/v3/payments/${encodeURIComponent(paymentId)}`,
    {
      headers: {
        Authorization: `Basic ${Buffer.from(credentials).toString("base64")}`,
        Accept: "application/json",
      },
    },
  );
  if (!response.ok) throw new Error(`YooKassa API HTTP ${response.status}`);
  return response.json();
}

function safeError(error) {
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  return error instanceof Error ? error.message.slice(0, 200) : "unknown_error";
}
