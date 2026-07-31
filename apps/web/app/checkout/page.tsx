import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getAccountById } from "@/lib/account-auth";
import { getAuthorizedUserId } from "@/lib/auth-v2/authorization";
import { startCheckoutOrder } from "@/lib/payments";
import {
  buildCheckoutHref,
  buildPublicPreviewHref,
  getPublicPlanByCode,
  readCheckoutPlanCode,
  readPublicPreviewInput,
} from "@/lib/publicProduct";
import { buildAccountNavigation } from "../ui/account-navigation";
import {
  InternalPageFrame,
  InternalPageHeader,
  InternalBackLink,
  ContentCard,
  ContentCardTitle,
  internalPageClasses as ipStyles,
} from "../ui/internal-page";
import { SiteFooter } from "../ui/site-footer";
import ppStyles from "../ui/page-primitives.module.css";
import LandingCheckoutAnalytics from "../landing-checkout-analytics";
import { LANDING_ANALYTICS_EVENT } from "../../lib/landing-analytics-contract";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Оформление — Recruiter Radar",
  description: "Безопасное оформление пробной недели или заявки на подключение Recruiter Radar.",
};

export default async function CheckoutPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const input = readPublicPreviewInput(searchParams);
  const planCode = readCheckoutPlanCode(searchParams);
  const plan = getPublicPlanByCode(planCode);
  const checkoutHref = buildCheckoutHref({ ...input, planCode });
  const previewHref = buildPublicPreviewHref(input);
  const loginHref = `/login?returnTo=${encodeURIComponent(checkoutHref)}`;
  const isRequest = plan.isRecurring;
  const checkoutError = typeof searchParams.error === "string" ? searchParams.error : null;
  const account = await getAccountById(await getAuthorizedUserId("billing:manage")).catch(() => null);

  async function startCheckoutAction(formData: FormData) {
    "use server";
    const currentAccount = await getAccountById(await getAuthorizedUserId("billing:manage"));
    if (!currentAccount) redirect(`/login?returnTo=${encodeURIComponent(checkoutHref)}`);

    const agencyNameValue = formData.get("agencyName");
    const agencyName = typeof agencyNameValue === "string" ? agencyNameValue.trim() : "";
    if (!agencyName || agencyName.length > 160) {
      redirect(`${checkoutHref}${checkoutHref.includes("?") ? "&" : "?"}error=agency`);
    }

    if (formData.get("legalAccepted") !== "on") {
      redirect(`${checkoutHref}${checkoutHref.includes("?") ? "&" : "?"}error=legal`);
    }

    const result = await startCheckoutOrder({
      userId: currentAccount.id,
      productCode: planCode,
      customerName: agencyName,
      customerContact: currentAccount.email,
      specialization: input.specialization || null,
      city: input.targetCity || null,
      includeKeywords: input.includeKeywords || null,
      excludeKeywords: input.excludeKeywords || null,
      dailyDigestLimit: input.dailyDigestLimit,
      siteUrl: process.env.PAYMENTS_SITE_URL ?? "http://localhost:3000",
    });
    redirect(result.redirectUrl);
  }

  return (
    <InternalPageFrame navItems={buildAccountNavigation("dashboard")} footer={<SiteFooter />}>
      <LandingCheckoutAnalytics
        submitEvent={
          isRequest
            ? LANDING_ANALYTICS_EVENT.continuationRequested
            : LANDING_ANALYTICS_EVENT.paymentStarted
        }
      />
      <InternalPageHeader
        title={isRequest ? `Подключение: ${plan.name}` : "Оформление пробной недели"}
        subtitle="Заказ привязан к подтверждённому аккаунту — статусы и настройки не потеряются после оплаты."
      />
      <div className={ipStyles.narrowLayout}>
        <ContentCard>
          <ContentCardTitle>{plan.name}</ContentCardTitle>
          <p className={ipStyles.bodyText}>
            {isRequest
              ? "Оставьте заявку на долгосрочный тариф. Мы свяжемся по рабочему email и согласуем подключение без автоматического списания."
              : "Оплата запускается только после явного подтверждения. Затем вы настроите профиль поиска и получите первый тестовый радар."}
          </p>
          <div className={ipStyles.fieldRow}>Тариф: <strong className={ipStyles.fieldRowStrong}>{plan.name}</strong></div>
          <div className={ipStyles.fieldRow}>Стоимость: <strong className={ipStyles.fieldRowStrong}>{plan.price}</strong></div>
          {input.specialization ? <div className={ipStyles.fieldRow}>Специализация: <strong className={ipStyles.fieldRowStrong}>{input.specialization}</strong></div> : null}
          {input.targetCity ? <div className={ipStyles.fieldRow}>Город: <strong className={ipStyles.fieldRowStrong}>{input.targetCity}</strong></div> : null}

          {account ? (
            <form
              action={startCheckoutAction}
              style={{ display: "grid", gap: 14, marginTop: 18 }}
              data-checkout-form
            >
              <label className={ppStyles.field}>
                <span className={ppStyles.fieldLabel}>Название агентства или команды</span>
                <input className={ppStyles.input} name="agencyName" required maxLength={160} autoComplete="organization" placeholder="Например, Northstar Recruiting" />
              </label>

              {checkoutError === "agency" ? (
                <p role="alert" style={{ margin: 0, color: "var(--danger, #b42318)" }}>
                  Укажите корректное название агентства или команды.
                </p>
              ) : null}

              <p className={ipStyles.bodyTextMutedBlock}>Аккаунт: {account.email}. На этот адрес придут документы и ссылка для возврата к настройке.</p>

              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, lineHeight: 1.45 }}>
                <input
                  type="checkbox"
                  name="legalAccepted"
                  required
                  style={{ marginTop: 4, width: 18, height: 18, flex: "0 0 auto" }}
                />
                <span>
                  Я принимаю <Link href="/terms">публичную оферту</Link> и подтверждаю,
                  что ознакомлен с <Link href="/privacy">политикой обработки персональных данных</Link>.
                </span>
              </label>

              {checkoutError === "legal" ? (
                <p role="alert" style={{ margin: 0, color: "var(--danger, #b42318)" }}>
                  Для продолжения необходимо принять оферту и ознакомиться с политикой обработки данных.
                </p>
              ) : null}

              <button type="submit" className={ppStyles.primaryAction}>
                {isRequest ? "Оставить заявку" : "Перейти к оплате"}
              </button>
            </form>
          ) : (
            <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
              <p className={ipStyles.bodyTextMutedBlock}>Сначала подтвердите рабочий email. Вход без пароля занимает один шаг и создаёт защищённый личный кабинет.</p>
              <Link href={loginHref} className={ppStyles.primaryAction}>Войти или создать аккаунт</Link>
            </div>
          )}
        </ContentCard>

        <InternalBackLink href={previewHref}>Изменить параметры радара</InternalBackLink>
      </div>
    </InternalPageFrame>
  );
}
