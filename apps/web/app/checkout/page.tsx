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
import {
  InternalPageFrame,
  InternalPageHeader,
  InternalBackLink,
  ContentCard,
  ContentCardTitle,
  internalPageClasses as ipStyles,
} from "../ui/internal-page";
import ppStyles from "../ui/page-primitives.module.css";
import LandingCheckoutAnalytics from "../landing-checkout-analytics";
import { LANDING_ANALYTICS_EVENT } from "../../lib/landing-analytics-contract";
import s from "./checkout.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Оплата доступа — Recruiter Radar",
  description: "Разовая безопасная оплата доступа к Recruiter Radar через Robokassa.",
  robots: { index: false, follow: false },
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
  const account = await getAccountById(await getAuthorizedUserId("billing:manage")).catch(() => null);
  const error = typeof searchParams.error === "string" ? searchParams.error : "";

  async function startCheckoutAction(formData: FormData) {
    "use server";
    const currentAccount = await getAccountById(await getAuthorizedUserId("billing:manage"));
    if (!currentAccount) redirect(`/login?returnTo=${encodeURIComponent(checkoutHref)}`);

    const separator = checkoutHref.includes("?") ? "&" : "?";
    const agencyName = readFormText(formData, "agencyName");
    const payerType = readFormText(formData, "payerType") === "individual" ? "individual" : "business";
    const buyerInn = readFormText(formData, "buyerInn").replace(/\D/g, "");

    if (!agencyName || agencyName.length > 160) {
      redirect(`${checkoutHref}${separator}error=agency`);
    }
    if (payerType === "business" && !/^(?:\d{10}|\d{12})$/.test(buyerInn)) {
      redirect(`${checkoutHref}${separator}error=inn`);
    }
    if (formData.get("acceptTerms") !== "on" || formData.get("acceptPersonalData") !== "on") {
      redirect(`${checkoutHref}${separator}error=legal`);
    }

    const legalAcceptance = buildLegalAcceptanceAudit();
    const result = await startCheckoutOrder({
      userId: currentAccount.id,
      productCode: planCode,
      customerName: agencyName,
      customerContact: currentAccount.email,
      payerType,
      buyerInn: payerType === "business" ? buyerInn : null,
      legalAcceptance,
      specialization: input.specialization || null,
      city: input.targetCity || null,
      includeKeywords: input.includeKeywords || null,
      excludeKeywords: input.excludeKeywords || null,
      dailyDigestLimit: input.dailyDigestLimit,
      comment: JSON.stringify({
        schema: "checkout-details-v2",
        legalAcceptance,
        payer: {
          type: payerType,
          buyerInn: payerType === "business" ? buyerInn : null,
        },
      }),
      siteUrl: process.env.PAYMENTS_SITE_URL ?? "http://localhost:3000",
    });
    redirect(result.redirectUrl);
  }

  return (
    <InternalPageFrame>
      <LandingCheckoutAnalytics submitEvent={LANDING_ANALYTICS_EVENT.paymentStarted} />
      <InternalPageHeader
        title="Оплата доступа"
        subtitle="Проверьте заказ и оплатите выбранный период один раз. Автопродления и скрытых списаний нет."
      />

      <div className={ipStyles.narrowLayout}>
        <ContentCard>
          <div className={s.checkoutGrid}>
            <div className={s.planHeader}>
              <ContentCardTitle>{plan.name}</ContentCardTitle>
              <p className={ipStyles.bodyText}>{plan.description}</p>
            </div>

            <div className={s.orderSummary} aria-label="Состав заказа">
              <div className={s.summaryRow}><span>Услуга</span><strong>Доступ к Recruiter Radar</strong></div>
              <div className={s.summaryRow}><span>Период</span><strong>{plan.cadence}</strong></div>
              <div className={s.summaryRow}><span>Продление</span><strong>только новым заказом</strong></div>
              {input.specialization ? <div className={s.summaryRow}><span>Специализация</span><strong>{input.specialization}</strong></div> : null}
              {input.targetCity ? <div className={s.summaryRow}><span>География</span><strong>{input.targetCity}</strong></div> : null}
              <div className={`${s.summaryRow} ${s.priceRow}`}><span>Итого</span><strong>{plan.price}</strong></div>
            </div>

            <div className={s.trustGrid}>
              <TrustItem title="Robokassa" text="Карта и CVC вводятся только на защищённой платёжной странице" />
              <TrustItem title="Разовая оплата" text="Карта не сохраняется, автоматических списаний нет" />
              <TrustItem title="Чек НПД" text="Электронный чек будет направлен на e-mail аккаунта" />
            </div>

            {account ? (
              <form action={startCheckoutAction} className={s.form} data-checkout-form>
                <label className={ppStyles.field}>
                  <span className={ppStyles.fieldLabel}>Название агентства или команды</span>
                  <input
                    className={ppStyles.input}
                    name="agencyName"
                    required
                    maxLength={160}
                    autoComplete="organization"
                    placeholder="Например, Northstar Recruiting"
                  />
                </label>

                <fieldset className={s.payerFieldset}>
                  <legend className={s.fieldsetLegend}>Кто оплачивает</legend>
                  <div className={s.payerOptions}>
                    <label className={s.radioOption}>
                      <input type="radio" name="payerType" value="business" defaultChecked />
                      <span><strong>ООО или ИП</strong><small>ИНН попадёт в данные для чека НПД</small></span>
                    </label>
                    <label className={s.radioOption}>
                      <input type="radio" name="payerType" value="individual" />
                      <span><strong>Физическое лицо</strong><small>Чек оформляется на e-mail покупателя</small></span>
                    </label>
                  </div>
                  <label className={ppStyles.field}>
                    <span className={ppStyles.fieldLabel}>ИНН покупателя — для ООО или ИП</span>
                    <input
                      className={ppStyles.input}
                      name="buyerInn"
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={12}
                      pattern="(?:\d{10}|\d{12})"
                      placeholder="10 цифр для ООО или 12 цифр для ИП"
                      aria-describedby="buyer-inn-hint"
                    />
                  </label>
                  <p id="buyer-inn-hint" className={s.hint}>
                    ИНН нужен для корректного чека при оплате от организации или ИП. Для оплаты как физическое лицо поле можно оставить пустым.
                  </p>
                </fieldset>

                <p className={ipStyles.bodyTextMutedBlock}>
                  Аккаунт: <strong>{account.email}</strong>. На этот адрес придут статус заказа, чек и ссылка для продолжения настройки.
                </p>

                <fieldset className={s.legalFieldset}>
                  <legend className={s.fieldsetLegend}>Подтверждение условий</legend>
                  <label className={s.checkOption}>
                    <input type="checkbox" name="acceptTerms" required />
                    <span>
                      Я принимаю <Link href="/terms" target="_blank" rel="noreferrer">публичную оферту</Link>, ознакомлен с <Link href="/payment-and-refund" target="_blank" rel="noreferrer">порядком оплаты и возврата</Link> и подтверждаю выбранные срок и стоимость.
                    </span>
                  </label>

                  <label className={s.checkOption}>
                    <input type="checkbox" name="acceptPersonalData" required />
                    <span>
                      Я отдельно даю <Link href="/personal-data-consent" target="_blank" rel="noreferrer">согласие на обработку персональных данных</Link> и ознакомлен с <Link href="/privacy" target="_blank" rel="noreferrer">политикой</Link>.
                    </span>
                  </label>
                </fieldset>

                {error === "agency" ? <p role="alert" className={s.error}>Укажите корректное название агентства или команды.</p> : null}
                {error === "inn" ? <p role="alert" className={s.error}>Для ООО укажите ИНН из 10 цифр, для ИП — из 12 цифр.</p> : null}
                {error === "legal" ? <p role="alert" className={s.error}>Для оплаты отдельно подтвердите оферту и согласие на обработку данных.</p> : null}

                <button type="submit" className={ppStyles.primaryAction}>
                  Перейти к оплате {plan.price}
                </button>
                <p className={s.actionHint}>
                  Откроется платёжная страница Robokassa. Доступ включится только после серверного подтверждения успешной операции.
                </p>
              </form>
            ) : (
              <div className={s.form}>
                <p className={ipStyles.bodyTextMutedBlock}>
                  Сначала подтвердите рабочий e-mail. Заказ будет привязан к аккаунту, поэтому статус оплаты и настройки не потеряются.
                </p>
                <Link href={loginHref} className={ppStyles.primaryAction}>Войти или создать аккаунт</Link>
              </div>
            )}

            <nav className={s.documentLinks} aria-label="Документы покупки">
              <Link href="/legal">Реквизиты продавца</Link>
              <Link href="/terms">Оферта</Link>
              <Link href="/payment-and-refund">Оплата и возврат</Link>
              <Link href="/privacy">Персональные данные</Link>
            </nav>

            <p className={s.actionHint}>
              Продавец: самозанятый {OPERATOR_REQUISITES.fullName}, ИНН {OPERATOR_REQUISITES.inn}, {OPERATOR_REQUISITES.city}. Поддержка: <a href={`mailto:${OPERATOR_REQUISITES.email}`}>{OPERATOR_REQUISITES.email}</a>.
            </p>
          </div>
        </ContentCard>

        <InternalBackLink href={previewHref}>Изменить параметры радара</InternalBackLink>
      </div>
    </InternalPageFrame>
  );
}

function TrustItem({ title, text }: { title: string; text: string }) {
  return (
    <div className={s.trustItem}>
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

function readFormText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}
