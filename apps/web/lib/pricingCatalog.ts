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
  "ежедневный радар с подтверждённым наймом по каждой компании",
  "профиль поиска под нишу и географию агентства",
  "оценка уверенности и понятное «почему сейчас» по каждому лиду",
  "доказательства найма и безопасный путь первого контакта",
  "Telegram-дайджест и рабочий веб-кабинет",
  "обратная связь, которая постепенно снижает нерелевантность",
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
    amountMinor: 299000,
    currency: "RUB",
    price: "2 990 ₽",
    monthlyEquivalent: "≈ 12 814 ₽ за 30 дней",
    discountLabel: null,
    description: "Короткий платный запуск без автопродления: проверить качество компаний, доказательств и поводов для выхода.",
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
    amountMinor: 999000,
    currency: "RUB",
    price: "9 990 ₽",
    monthlyEquivalent: "9 990 ₽ за 30 дней",
    discountLabel: "на 22% выгоднее недели",
    description: "Основной тариф для одного устойчивого клиентского направления агентства. Разовая оплата на 30 дней.",
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
    amountMinor: 2499000,
    currency: "RUB",
    price: "24 990 ₽",
    monthlyEquivalent: "8 330 ₽ за 30 дней",
    discountLabel: "экономия 4 980 ₽",
    description: "Для агентства, которое встраивает радар в регулярный лидген. Разовая оплата на 90 дней без автосписаний.",
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
