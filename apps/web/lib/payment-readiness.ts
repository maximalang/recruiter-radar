import { OPERATOR_REQUISITES } from "./operatorRequisites";
import { getPaymentProviderSetupState } from "./paymentsProvider";

export type PaymentReadinessReport = {
  provider: "stripe" | "yookassa" | null;
  mode: "test" | "live" | null;
  checkoutConfigured: boolean;
  webhookConfigured: boolean;
  siteUrlConfigured: boolean;
  selfServePilotReady: boolean;
  merchantModerationReady: boolean;
  liveLaunchReady: boolean;
  recurringBillingReady: false;
  rfProvider: { status: "blocked" | "ready"; provider: "yookassa" | null; blockers: string[] };
  merchantModeration: {
    status: "blocked" | "ready";
    publicSupportEmailConfigured: boolean;
    publicPhoneConfigured: boolean;
    publicPostalAddressConfigured: boolean;
    requiredPagesPublished: boolean;
    tariffsPublished: boolean;
    digitalFulfillmentDescribed: boolean;
    refundProcedureDescribed: boolean;
    blockers: string[];
  };
  launch: {
    status: "blocked" | "ready";
    technicalVerificationRecorded: boolean;
    npdReceiptVerificationRecorded: boolean;
    pdnComplianceVerificationRecorded: boolean;
    blockers: string[];
  };
  customerFlow: {
    pilot: "self_service_payment" | "saved_request";
    monthly: "sales_request";
    quarterly: "sales_request";
  };
};

export function buildPaymentReadinessReport(setup = getPaymentProviderSetupState()): PaymentReadinessReport {
  const yookassaSelected = setup.provider === "yookassa";
  const providerBlockers: string[] = [];
  if (!yookassaSelected) providerBlockers.push("PAYMENTS_PROVIDER должен быть равен yookassa.");
  if (!setup.configured) providerBlockers.push("Shop ID, secret key, явный YOOKASSA_MODE и канонические URL настроены не полностью.");
  if (!setup.webhookConfigured) providerBlockers.push("YOOKASSA_WEBHOOK_URL должен точно указывать на публичный webhook Recruiter Radar.");
  if (!setup.siteUrlConfigured) providerBlockers.push("PAYMENTS_SITE_URL должен быть равен https://recruiter-radar.ru.");

  const publicSupportEmailConfigured = isPublicSupportEmail(OPERATOR_REQUISITES.email);
  const publicPhoneConfigured = isRussianPublicPhone(OPERATOR_REQUISITES.phone);
  const publicPostalAddressConfigured = Boolean(OPERATOR_REQUISITES.postalAddress?.trim());
  const requiredPagesPublished = true;
  const tariffsPublished = true;
  const digitalFulfillmentDescribed = true;
  const refundProcedureDescribed = true;
  const merchantBlockers: string[] = [];
  if (!publicSupportEmailConfigured) merchantBlockers.push("Нужен публичный e-mail поддержки на домене recruiter-radar.ru.");
  if (!publicPhoneConfigured) merchantBlockers.push("Нужен подтверждённый российский телефон поддержки.");
  if (!publicPostalAddressConfigured) merchantBlockers.push("Нужен фактический адрес для корреспонденции в OPERATOR_PUBLIC_POSTAL_ADDRESS.");
  if (!requiredPagesPublished) merchantBlockers.push("Оферта, политика и реквизиты должны быть публичны.");
  if (!tariffsPublished) merchantBlockers.push("На сайте должны быть опубликованы реальные тарифы и цены.");
  if (!digitalFulfillmentDescribed) merchantBlockers.push("Нужно описать порядок цифрового предоставления услуги.");
  if (!refundProcedureDescribed) merchantBlockers.push("Нужно описать отказ от услуги и порядок возврата.");

  const technicalVerificationRecorded = isIsoVerification(process.env.YOOKASSA_LAUNCH_VERIFIED_AT);
  const npdReceiptVerificationRecorded = isIsoVerification(process.env.NPD_RECEIPT_FLOW_VERIFIED_AT);
  const pdnComplianceVerificationRecorded = isIsoVerification(process.env.PDN_COMPLIANCE_VERIFIED_AT);
  const selfServePilotReady = yookassaSelected && setup.configured && setup.webhookConfigured && setup.siteUrlConfigured;
  const merchantModerationReady = merchantBlockers.length === 0;
  const launchBlockers = [...providerBlockers, ...merchantBlockers];
  if (setup.mode !== "live") launchBlockers.push("Перед production-запуском YOOKASSA_MODE должен быть равен live.");
  if (!technicalVerificationRecorded) launchBlockers.push("Не зафиксированы тестовый платёж, webhook replay, отмена и полный/частичный возврат.");
  if (!npdReceiptVerificationRecorded) launchBlockers.push("Не проверены формирование, отправка и корректировка чека НПД при возврате.");
  if (!pdnComplianceVerificationRecorded) launchBlockers.push("Не подтверждены локализация, инфраструктурный реестр и статус уведомления Роскомнадзора.");
  const liveLaunchReady = selfServePilotReady && merchantModerationReady && setup.mode === "live" && technicalVerificationRecorded && npdReceiptVerificationRecorded && pdnComplianceVerificationRecorded;

  return {
    provider: setup.provider,
    mode: setup.mode,
    checkoutConfigured: setup.configured,
    webhookConfigured: setup.webhookConfigured,
    siteUrlConfigured: setup.siteUrlConfigured,
    selfServePilotReady,
    merchantModerationReady,
    liveLaunchReady,
    recurringBillingReady: false,
    rfProvider: { status: selfServePilotReady ? "ready" : "blocked", provider: yookassaSelected ? "yookassa" : null, blockers: providerBlockers },
    merchantModeration: {
      status: merchantModerationReady ? "ready" : "blocked",
      publicSupportEmailConfigured,
      publicPhoneConfigured,
      publicPostalAddressConfigured,
      requiredPagesPublished,
      tariffsPublished,
      digitalFulfillmentDescribed,
      refundProcedureDescribed,
      blockers: merchantBlockers,
    },
    launch: {
      status: liveLaunchReady ? "ready" : "blocked",
      technicalVerificationRecorded,
      npdReceiptVerificationRecorded,
      pdnComplianceVerificationRecorded,
      blockers: launchBlockers,
    },
    customerFlow: {
      pilot: selfServePilotReady ? "self_service_payment" : "saved_request",
      monthly: "sales_request",
      quarterly: "sales_request",
    },
  };
}

function isPublicSupportEmail(value: string | null): boolean {
  const normalized = value?.trim().toLowerCase();
  return Boolean(normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) && normalized.endsWith("@recruiter-radar.ru"));
}

function isRussianPublicPhone(value: string | null): boolean {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"));
}

function isIsoVerification(value: string | undefined): boolean {
  const normalized = value?.trim();
  if (!normalized) return false;
  const parsed = new Date(normalized);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === normalized;
}
