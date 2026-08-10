export type PublicPlanCode = "pilot" | "monthly" | "quarterly";

export type PublicPlan = {
  code: PublicPlanCode;
  name: string;
  cadence: string;
  durationDays: number;
  amountMinor: number;
  currency: "RUB";
  price: string;
  monthlyEquivalent: string;
  discountLabel: string | null;
  description: string;
  bullets: string[];
  ctaLabel: string;
  isPrimary: boolean;
  /** Launch billing is one-time. Recurring is enabled only after provider approval. */
  isRecurring: false;
};

const SHARED_PLAN_BULLETS: string[] = [
  "ежедневный приоритет компаний с подтверждёнными hiring signals",
  "понятное «почему сейчас» и уровень уверенности по каждой возможности",
  "факты и источники для подготовки первого контакта",
  "профиль поиска под специализацию, географию и рабочие каналы агентства",
];

/**
 * Launch pricing deliberately uses one-time periods. This keeps the contract,
 * NPD receipt and refund flow transparent while Robokassa recurring payments
 * remain subject to separate provider approval and production verification.
 */
export const PUBLIC_PLANS: PublicPlan[] = [
  {
    code: "pilot",
    name: "Неделя",
    cadence: "7 дней",
    durationDays: 7,
    amountMinor: 99000,
    currency: "RUB",
    price: "990 ₽",
    monthlyEquivalent: "≈ 4 243 ₽ за 30 дней",
    discountLabel: null,
    description: "Короткий платный запуск: проверить качество компаний, доказательств и поводов для выхода без автопродления.",
    bullets: SHARED_PLAN_BULLETS,
    ctaLabel: "Запустить на 7 дней",
    isPrimary: false,
    isRecurring: false,
  },
  {
    code: "monthly",
    name: "Месяц",
    cadence: "30 дней",
    durationDays: 30,
    amountMinor: 299000,
    currency: "RUB",
    price: "2 990 ₽",
    monthlyEquivalent: "2 990 ₽ за 30 дней",
    discountLabel: "на 30% выгоднее недели",
    description: "Рабочий период для регулярного клиентского лидгена по одному или нескольким профилям поиска.",
    bullets: SHARED_PLAN_BULLETS,
    ctaLabel: "Подключить на месяц",
    isPrimary: true,
    isRecurring: false,
  },
  {
    code: "quarterly",
    name: "Квартал",
    cadence: "90 дней",
    durationDays: 90,
    amountMinor: 699000,
    currency: "RUB",
    price: "6 990 ₽",
    monthlyEquivalent: "2 330 ₽ за 30 дней",
    discountLabel: "экономия 1 980 ₽",
    description: "Самая низкая стоимость периода для агентства, которое встраивает радар в постоянный лидген.",
    bullets: SHARED_PLAN_BULLETS,
    ctaLabel: "Подключить на квартал",
    isPrimary: false,
    isRecurring: false,
  },
];

const PLAN_BY_CODE = Object.fromEntries(
  PUBLIC_PLANS.map((plan) => [plan.code, plan]),
) as Record<PublicPlanCode, PublicPlan>;

export function isPublicPlanCode(value: unknown): value is PublicPlanCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PLAN_BY_CODE, value);
}

export function normalizeLegacyPlanCode(value: string): PublicPlanCode {
  const normalized = value.trim().toLowerCase();
  if (normalized === "premium" || normalized === "yearly") return "quarterly";
  if (isPublicPlanCode(normalized)) return normalized;
  throw new Error(`Unknown product code: ${value}`);
}

export function getPublicPlanByCode(value: PublicPlanCode | string): PublicPlan {
  return PLAN_BY_CODE[normalizeLegacyPlanCode(value)];
}

export const PLAN_ENTITLEMENT_DAYS: Record<PublicPlanCode, number> = {
  pilot: 7,
  monthly: 30,
  quarterly: 90,
};
