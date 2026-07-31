import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getAccountById } from "@/lib/account-auth";
import { getAuthorizedUserId } from "@/lib/auth-v2/authorization";
import { buildLegalAcceptanceAudit } from "@/lib/legalDocuments";
import { OPERATOR_REQUISITES } from "@/lib/operatorRequisites";
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
  description: "Проверка тарифа, условий цифрового доступа и безопасная оплата Recruiter Radar через ЮKassa.",
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
    if (formData.get("offerAccepted") !== "on") {
      redirect(`${checkoutHref}${checkoutHref.includes("?") ? "&" : "?"}error=offer`);
    }
    if (formData.get("personalDataAccepted") !== "on") {
      redirect(`${checkoutHref}${checkoutHref.includes("?") ? "&" : "?"}error=personal-data`);
    }

    const legalAcceptance = buildLegalAcceptanceAudit();
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
      comment: JSON.stringify({ type: "legal_acceptance", ...legalAcceptance }),
      legalAcceptance,
      siteUrl: process.env.PAYMENTS_SITE_URL ?? "http://localhost:3000",
    });
    redirect(result.redirectUrl);
  }

  return (
    <InternalPageFrame navItems={buildAccountNavigation("dashboard")} footer={<SiteFooter />}>
      <LandingCheckoutAnalytics
        submitEvent={isRequest ? LANDING_ANALYTICS_EVENT.continuationRequested : LANDING_ANALYTICS_EVENT.paymentStarted}
      />
      <InternalPageHeader
        title={isRequest ? `Подключение: ${plan.name}` : "Оформление пробной недели"}
        subtitle="До подтверждения вы видите услугу, срок, итоговую стоимость, порядок получения доступа и юридические условия."
      />
      <div className={ipStyles.narrowLayout}>
        <ContentCard>
          <ContentCardTitle>{plan.name}</ContentCardTitle>
          <p className={ipStyles.bodyText}>
            {isRequest
              ? "Оставьте заявку на долгосрочный тариф. Мы свяжемся по рабочему e-mail и согласуем подключение без автоматического списания."
              : "Разовая оплата через ЮKassa. После подтверждения платежа откроется настройка профиля и цифрового доступа."}
          </p>

          <div className={ppStyles.summaryBox} style={{ marginTop: 16 }}>
            <div className={ipStyles.fieldRow}>Услуга: <strong className={ipStyles.fieldRowStrong}>Доступ к Recruiter Radar</strong></div>
            <div className={ipStyles.fieldRow}>Тариф: <strong className={ipStyles.fieldRowStrong}>{plan.name}</strong></div>
            <div className={ipStyles.fieldRow}>Срок доступа: <strong className={ipStyles.fieldRowStrong}>{plan.cadence}</strong></div>
            <div className={ipStyles.fieldRow}>Итого: <strong className={ipStyles.fieldRowStrong}>{plan.price}</strong></div>
            <div className={ipStyles.fieldRow}>Продление: <strong className={ipStyles.fieldRowStrong}>без автоматических списаний</strong></div>
          </div>

          {input.specialization ? <div className={ipStyles.fieldRow}>Специализация: <strong className={ipStyles.fieldRowStrong}>{input.specialization}</strong></div> : null}
          {input.targetCity ? <div className={ipStyles.fieldRow}>Город: <strong className={ipStyles.fieldRowStrong}>{input.targetCity}</strong></div> : null}

          {!isRequest ? (
            <div className={ipStyles.bodyTextMutedBlock} style={{ marginTop: 16 }}>
              <strong>Получение услуги.</strong> Физической доставки нет. После успешной оплаты откроется настройка профиля в личном кабинете. Если потребуется ручная проверка, первый рабочий радар будет подготовлен не позднее одного рабочего дня после получения необходимых данных. Чек НПД направляется в электронной форме.
            </div>
          ) : null}

          {account ? (
            <form action={startCheckoutAction} style={{ display: "grid", gap: 14, marginTop: 18 }} data-checkout-form>
              <label className={ppStyles.field}>
                <span className={ppStyles.fieldLabel}>Название агентства или команды</span>
                <input className={ppStyles.input} name="agencyName" required maxLength={160} autoComplete="organization" placeholder="Например, Northstar Recruiting" />
              </label>

              {checkoutError === "agency" ? <p role="alert" style={{ margin: 0, color: "var(--danger, #b42318)" }}>Укажите корректное название агентства или команды.</p> : null}

              <p className={ipStyles.bodyTextMutedBlock}>
                Аккаунт и контакт для документов: <strong>{account.email}</strong>. На этот адрес будут направлены сообщения по заказу и чек НПД.
              </p>

              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, lineHeight: 1.45 }}>
                <input type="checkbox" name="offerAccepted" required style={{ marginTop: 4, width: 18, height: 18, flex: "0 0 auto" }} />
                <span>Я принимаю <Link href="/terms">публичную оферту</Link>, подтверждаю выбранные тариф, срок и стоимость, а также ознакомлен с порядком отказа от услуги и возврата в разделе 6 оферты.</span>
              </label>

              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, lineHeight: 1.45 }}>
                <input type="checkbox" name="personalDataAccepted" required style={{ marginTop: 4, width: 18, height: 18, flex: "0 0 auto" }} />
                <span>Я отдельно подтверждаю <Link href="/personal-data-consent">согласие на обработку персональных данных</Link> для аккаунта и исполнения заказа и ознакомлен с <Link href="/privacy">политикой обработки персональных данных</Link>.</span>
              </label>

              {checkoutError === "offer" ? <p role="alert" style={{ margin: 0, color: "var(--danger, #b42318)" }}>Для продолжения необходимо принять оферту и условия заказа.</p> : null}
              {checkoutError === "personal-data" ? <p role="alert" style={{ margin: 0, color: "var(--danger, #b42318)" }}>Для оформления необходимо отдельное согласие на обработку данных заказа.</p> : null}

              <button type="submit" className={ppStyles.primaryAction}>
                {isRequest ? "Оставить заявку" : `Оплатить ${plan.price} через ЮKassa`}
              </button>

              <p className={ipStyles.bodyTextMutedBlock} style={{ margin: 0 }}>
                Вопросы до оплаты: <a href={`mailto:${OPERATOR_REQUISITES.email}`}>{OPERATOR_REQUISITES.email}</a>. Данные банковской карты вводятся на стороне ЮKassa.
              </p>
            </form>
          ) : (
            <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
              <p className={ipStyles.bodyTextMutedBlock}>Сначала подтвердите рабочий e-mail. Вход без пароля занимает один шаг и создаёт защищённый личный кабинет.</p>
              <Link href={loginHref} className={ppStyles.primaryAction}>Войти или создать аккаунт</Link>
            </div>
          )}
        </ContentCard>

        <InternalBackLink href={previewHref}>Изменить параметры радара</InternalBackLink>
      </div>
    </InternalPageFrame>
  );
}
