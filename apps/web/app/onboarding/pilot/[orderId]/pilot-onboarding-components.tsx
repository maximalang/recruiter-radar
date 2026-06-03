import Link from "next/link";
import type { ReactNode } from "react";

import type { CheckoutOrder, CheckoutOrderOnboardingStep } from "../../../../lib/payments";
import { NoticeBox } from "../../../ui/page-primitives";
import styles from "./pilot-onboarding-components.module.css";

export function InstructionCard(props: { children: ReactNode }) {
  return <div className={styles.instructionCard}>{props.children}</div>;
}

export function UnpaidState(props: { order: CheckoutOrder }) {
  return (
    <NoticeBox
      tone="warning"
      title="Оплата ещё не подтверждена"
      description={props.order.payload.paymentMessage ?? "Завершите оплату, чтобы открыть онбординг."}
    >
      <div className={styles.actions}>
        <Link href="/checkout" className={styles.primaryLinkFallback}>Перейти к оплате</Link>
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
