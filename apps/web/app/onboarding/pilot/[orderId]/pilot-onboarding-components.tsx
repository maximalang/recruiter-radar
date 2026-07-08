import Link from "next/link";
import type { ReactNode } from "react";

import type { CheckoutOrder, CheckoutOrderOnboardingStep } from "../../../../lib/payments";
import { NoticeBox } from "../../../ui/page-primitives";
import { scoreBand, formatSignalStrength } from "../../../../lib/scoring/score-display";
import styles from "./pilot-onboarding-components.module.css";

/**
 * Numbered instruction card for the wizard steps. When `step` is provided,
 * renders a circle-number badge (1/2/3) so the page no longer composes inline
 * "1. / 2. / 3." text prefixes — the affordance is visual and consistent with
 * the step-rail numbering, not a typographic glyph. Without `step` it renders
 * plain children (used by the unpaid-state path and any non-step caller).
 */
export function InstructionCard(props: { children: ReactNode; step?: number }) {
  if (props.step == null) {
    return <div className={styles.instructionCard}>{props.children}</div>;
  }
  return (
    <div className={styles.instructionCard} data-step={String(props.step)}>
      <span className={styles.instructionNumber} aria-hidden="true">{props.step}</span>
      <span className={styles.instructionBody}>{props.children}</span>
    </div>
  );
}

/**
 * Shared score read for the onboarding preview card (T1.3).
 *
 * The preview used to print a second score vocabulary — `score 247.0` — that
 * drifted from /leads (which speaks "Горячий/Тёплый/Холодный" + a 0–4 signal
 * strength). This helper funnels the preview through the same
 * `lib/scoring/score-display` module every other surface uses, so the first
 * radar a recruit sees in onboarding already speaks the language they'll meet
 * daily. The raw `total_score` is the persisted evidence-ranking score; the
 * shared module converts it once to the [0,4] scale.
 */
export function formatPreviewScore(rawScore: number | null | undefined): {
  bandLabel: string;
  strength: string;
} {
  return {
    bandLabel: scoreBand(rawScore).label,
    strength: formatSignalStrength(rawScore),
  };
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
