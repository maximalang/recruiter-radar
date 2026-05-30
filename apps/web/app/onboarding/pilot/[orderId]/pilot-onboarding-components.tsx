import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import type { CheckoutOrder, CheckoutOrderOnboardingStep } from "../../../../lib/payments";
import { NoticeBox } from "../../../ui/page-primitives";

export function InstructionCard(props: { children: ReactNode }) {
  return <div style={instructionCardStyle}>{props.children}</div>;
}

export function UnpaidState(props: { order: CheckoutOrder }) {
  return (
    <NoticeBox
      tone="warning"
      title="Оплата ещё не подтверждена"
      description={props.order.payload.paymentMessage ?? "Завершите оплату, чтобы открыть онбординг."}
    >
      <div style={actionsStyle}>
        <Link href="/checkout" style={primaryLinkFallbackStyle}>Перейти к оплате</Link>
      </div>
    </NoticeBox>
  );
}

export function formatCompanyCount(value: number): string {
  return `${value} ${value === 1 ? "компания" : value < 5 ? "компании" : "компаний"}`;
}

export function formatVacanciesCount(value: number): string {
  return `${value} вакансий`;
}

export function formatDateTime(value: string | null): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function translateOrderStatus(status: CheckoutOrder["status"]): string {
  switch (status) {
    case "paid":
      return "оплачено";
    case "pending":
      return "в обработке";
    case "created":
      return "создан";
    case "canceled":
      return "отменён";
    case "unavailable":
      return "недоступно";
    default:
      return "ошибка";
  }
}

export function getCurrentStep(order: CheckoutOrder, requestedStep: CheckoutOrderOnboardingStep | null): CheckoutOrderOnboardingStep {
  if (requestedStep) {
    return requestedStep;
  }

  return order.payload.onboardingStep;
}

export function getRequestedStep(searchParams: Record<string, string | string[] | undefined>, order: CheckoutOrder): CheckoutOrderOnboardingStep | null {
  const value = getSearchParamValue(searchParams, "step");

  if (value === "confirm-profile" || value === "telegram" || value === "preview" || value === "complete") {
    return value;
  }

  return order.payload.onboardingStep ?? null;
}

export function getSearchParamValue(searchParams: Record<string, string | string[] | undefined>, key: string): string | null {
  const value = searchParams[key];

  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : null;
  }

  return typeof value === "string" ? value : null;
}

export function isStepComplete(step: CheckoutOrderOnboardingStep, currentStep: CheckoutOrderOnboardingStep): boolean {
  const steps: CheckoutOrderOnboardingStep[] = ["confirm-profile", "telegram", "preview", "complete"];
  return steps.indexOf(step) <= steps.indexOf(currentStep);
}

export const actionsStyle: CSSProperties = { display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" };
export const formStyle: CSSProperties = { display: "grid", gap: "14px" };
export const instructionCardStyle: CSSProperties = { padding: "14px 16px", borderRadius: "16px", border: "1px solid rgba(15, 23, 42, 0.08)", backgroundColor: "#fbfcfd" };
export const instructionGridStyle: CSSProperties = { display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" };
export const openerLabelStyle: CSSProperties = { fontSize: "0.78rem", fontWeight: 700, color: "#667085" };
export const openerStyle: CSSProperties = { display: "grid", gap: "6px" };
export const previewCardStyle: CSSProperties = { display: "grid", gap: "12px", padding: "16px", borderRadius: "18px", border: "1px solid rgba(15, 23, 42, 0.08)", backgroundColor: "#fff" };
export const previewChipStyle: CSSProperties = { display: "inline-flex", padding: "4px 8px", borderRadius: "999px", backgroundColor: "#f8fafc", border: "1px solid rgba(15, 23, 42, 0.08)" };
export const previewHeaderStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" };
export const previewReasonListStyle: CSSProperties = { display: "grid", gap: "6px" };
export const scorePillStyle: CSSProperties = { display: "inline-flex", padding: "4px 8px", borderRadius: "999px", backgroundColor: "#eef2ff", color: "#3730a3", fontSize: "0.82rem", fontWeight: 700 };
export const stepNumberStyle: CSSProperties = { fontVariantNumeric: "tabular-nums", fontWeight: 700 };
export const stepPillStyle = (isCurrent: boolean, isComplete: boolean): CSSProperties => ({ display: "inline-flex", gap: "8px", padding: "10px 12px", borderRadius: "999px", border: "1px solid rgba(15, 23, 42, 0.08)", backgroundColor: isCurrent ? "#111827" : isComplete ? "#eefbf3" : "#fff", color: isCurrent ? "#fff" : "#111827" });
export const stepRailStyle: CSSProperties = { display: "flex", gap: "10px", flexWrap: "wrap" };
export const submitRowStyle: CSSProperties = { display: "grid", gap: "10px" };
export const wizardSectionStyle: CSSProperties = { display: "grid", gap: "16px" };

const primaryLinkFallbackStyle: CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "12px 18px", borderRadius: "14px", border: "1px solid rgba(15, 23, 42, 0.9)", background: "linear-gradient(135deg, #111827 0%, #1f3a8a 100%)", color: "#fff", textDecoration: "none", fontWeight: 700 };
