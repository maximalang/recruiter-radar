import Link from "next/link";
import { redirect } from "next/navigation";

import { startCheckoutOrder } from "../../lib/payments";
import { buildCheckoutHref, readPublicPreviewInput } from "../../lib/publicProduct";
import { generateOwnerId, readOwnerSession, writeOwnerSession } from "../../lib/session";
import {
  InternalPageFrame,
  InternalPageHeader,
  InternalBackLink,
  ContentCard,
  ContentCardTitle,
  type NavItem,
  internalPageClasses as s,
} from "../ui/internal-page";
import ppStyles from "../ui/page-primitives.module.css";

const CHECKOUT_NAV: NavItem[] = [
  { href: '/dashboard', label: '📊 Дашборд' },
  { href: '/leads', label: '🎯 Лиды' },
];

export const dynamic = "force-dynamic";

export default async function CheckoutPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const input = readPublicPreviewInput(searchParams);
  const restartHref = buildCheckoutHref(input);

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
      productCode: "pilot",
      customerName: "Self-serve pilot checkout",
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
      <InternalPageHeader title="Оформление пилота" />
      <div className={s.narrowLayout}>
        <ContentCard>
          <ContentCardTitle>🎯 Пилотный запуск</ContentCardTitle>
          <p className={s.bodyText}>
            Оплата запускается только после явного подтверждения. После оплаты мы начнём генерировать ежедневный радар компаний для вашей ниши.
          </p>
          {input.specialization && (
            <div className={s.fieldRow}>
              Специализация: <strong className={s.fieldRowStrong}>{input.specialization}</strong>
            </div>
          )}
          {input.targetCity && (
            <div className={s.fieldRow}>
              Город: <strong className={s.fieldRowStrong}>{input.targetCity}</strong>
            </div>
          )}
          {!existingOwnerId ? (
            <p className={s.bodyTextMutedBlock}>
              Нажмите кнопку ниже, чтобы запустить пилот.
            </p>
          ) : null}
          <form action={startCheckoutAction}>
            <button type="submit" className={ppStyles.primaryAction}>
              Перейти к оплате
            </button>
          </form>
        </ContentCard>

        <InternalBackLink href={restartHref}>Обновить параметры пилота</InternalBackLink>
      </div>
    </InternalPageFrame>
  );
}
