import Link from "next/link";
import { redirect } from "next/navigation";

import { startCheckoutOrder } from "../../lib/payments";
import {
  buildCheckoutHref,
  getPublicPlanByCode,
  readCheckoutPlanCode,
  readPublicPreviewInput,
} from "../../lib/publicProduct";
import { generateOwnerId, readOwnerSession, writeOwnerSession } from "../../lib/session";
import {
  InternalPageFrame,
  InternalPageHeader,
  InternalBackLink,
  ContentCard,
  ContentCardTitle,
  type NavItem,
  internalPageClasses as ipStyles,
} from "../ui/internal-page";
import ppStyles from "../ui/page-primitives.module.css";

const CHECKOUT_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Дашборд' },
  { href: '/leads', label: 'Лиды' },
];

export const dynamic = "force-dynamic";

export default async function CheckoutPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const input = readPublicPreviewInput(searchParams);
  const planCode = readCheckoutPlanCode(searchParams);
  const plan = getPublicPlanByCode(planCode);
  const restartHref = buildCheckoutHref({ ...input, planCode });

  // Recurring plans (monthly, premium) have no self-serve subscription flow while
  // billing is stubbed — the checkout captures a sales request instead of a payment.
  const isRequest = plan.isRecurring;

  // Read existing session — do NOT fall back to CHECKOUT_DEFAULT_OWNER_ID for public customers.
  const existingOwnerId = await readOwnerSession();

  async function startCheckoutAction() {
    "use server";

    // Resolve or mint a per-visitor owner ID inside the action (write path only).
    let ownerId = await readOwnerSession();

    if (!ownerId) {
      ownerId = generateOwnerId();
    }

    const result = await startCheckoutOrder({
      userId: ownerId,
      productCode: planCode,
      customerName: isRequest ? `Sales request: ${plan.name}` : "Self-serve pilot checkout",
      customerContact: "checkout@recruiter-radar.local",
      specialization: input.specialization || null,
      city: input.targetCity || null,
      includeKeywords: input.includeKeywords || null,
      excludeKeywords: input.excludeKeywords || null,
      dailyDigestLimit: input.dailyDigestLimit,
      siteUrl: process.env.PAYMENTS_SITE_URL ?? "http://localhost:3000"
    });

    await writeOwnerSession(ownerId);
    redirect(result.redirectUrl);
  }

  return (
    <InternalPageFrame navItems={CHECKOUT_NAV}>
      <InternalPageHeader title={isRequest ? `Подключение: ${plan.name}` : "Оформление пилота"} />
      <div className={ipStyles.narrowLayout}>
        <ContentCard>
          <ContentCardTitle>{isRequest ? plan.name : "Пилотный запуск"}</ContentCardTitle>
          <p className={ipStyles.bodyText}>
            {isRequest
              ? "Это тариф с ежемесячным сопровождением. Оставьте заявку — мы свяжемся, чтобы подключить радар и согласовать оплату."
              : "Оплата запускается только после явного подтверждения. После оплаты мы начнём генерировать ежедневный радар компаний для вашей ниши."}
          </p>
          <div className={ipStyles.fieldRow}>
            Тариф: <strong className={ipStyles.fieldRowStrong}>{plan.name}</strong>
          </div>
          <div className={ipStyles.fieldRow}>
            Стоимость: <strong className={ipStyles.fieldRowStrong}>{plan.price}</strong>
          </div>
          {input.specialization && (
            <div className={ipStyles.fieldRow}>
              Специализация: <strong className={ipStyles.fieldRowStrong}>{input.specialization}</strong>
            </div>
          )}
          {input.targetCity && (
            <div className={ipStyles.fieldRow}>
              Город: <strong className={ipStyles.fieldRowStrong}>{input.targetCity}</strong>
            </div>
          )}
          {!existingOwnerId ? (
            <p className={ipStyles.bodyTextMutedBlock}>
              {isRequest
                ? "Нажмите кнопку ниже, чтобы оставить заявку."
                : "Нажмите кнопку ниже, чтобы запустить пилот."}
            </p>
          ) : null}
          <form action={startCheckoutAction}>
            <button type="submit" className={ppStyles.primaryAction}>
              {isRequest ? "Оставить заявку" : "Перейти к оплате"}
            </button>
          </form>
        </ContentCard>

        <InternalBackLink href={restartHref}>
          {isRequest ? "Изменить параметры" : "Обновить параметры пилота"}
        </InternalBackLink>
      </div>
    </InternalPageFrame>
  );
}
