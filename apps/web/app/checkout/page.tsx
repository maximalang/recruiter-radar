import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getAccountById } from "@/lib/account-auth";
import { getAuthorizedUserId } from "@/lib/auth-v2/authorization";
import { buildLegalAcceptanceAudit } from "@/lib/legalDocuments";
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
  title: "Оплата доступа — Recruiter Radar",
  description: "Разовая безопасная оплата доступа к Recruiter Radar через Robokassa.",
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
    const agencyNameValue = formData.get("agencyName");
    const agencyName = typeof agencyNameValue === "string" ? agencyNameValue.trim() : "";
    if (!agencyName || agencyName.length > 160) {
      redirect(`${checkoutHref}${separator}error=agency`);
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
      specialization: input.specialization || null,
      city: input.targetCity || null,
      includeKeywords: input.includeKeywords || null,
      excludeKeywords: input.excludeKeywords || null,
      dailyDigestLimit: input.dailyDigestLimit,
      comment: JSON.stringify({
        schema: "checkout-legal-acceptance-v1",
        legalAcceptance,
      }),
      siteUrl: process.env.PAYMENTS_SITE_URL ?? "http://localhost:3000",
    });
    redirect(result.redirectUrl);
  }

  return (
    <InternalPageFrame navItems={buildAccountNavigation("dashboard")} footer={<SiteFooter />}>
      <LandingCheckoutAnalytics submitEvent={LANDING_ANALYTICS_EVENT.paymentStarted} />
      <InternalPageHeader
        title="Оплата доступа"
        subtitle="Один раз оплачиваете выбранный период. Автопродления и скрытых списаний нет."
      />

      <div className={ipStyles.narrowLayout}>
        <ContentCard>
          <div style={{ display: "grid", gap: 18 }}>
            <div>
              <ContentCardTitle>{plan.name}</ContentCardTitle>
              <p className={ipStyles.bodyText} style={{ marginTop: 8 }}>{plan.description}</p>
            </div>

            <div style={{ display: "grid", gap: 10, padding: 16, border: "1px solid rgba(15,23,42,.1)", borderRadius: 14 }}>
              <div className={ipStyles.fieldRow}>Период: <strong className={ipStyles.fieldRowStrong}>{plan.cadence}</strong></div>
              <div className={ipStyles.fieldRow}>К оплате: <strong className={ipStyles.fieldRowStrong} style={{ fontSize: "1.2rem" }}>{plan.price}</strong></div>
              <div className={ipStyles.fieldRow}>Продление: <strong className={ipStyles.fieldRowStrong}>только вручную</strong></div>
              {input.specialization ? <div className={ipStyles.fieldRow}>Специализация: <strong className={ipStyles.fieldRowStrong}>{input.specialization}</strong></div> : null}
              {input.targetCity ? <div className={ipStyles.fieldRow}>География: <strong className={ipStyles.fieldRowStrong}>{input.targetCity}</strong></div> : null}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
              <TrustItem title="Безопасная оплата" text="Платёжная форма Robokassa" />
              <TrustItem title="Разовый платёж" text="Карта не сохраняется" />
              <TrustItem title="Чек НПД" text="Придёт на e-mail" />
            </div>

            {account ? (
              <form action={startCheckoutAction} style={{ display: "grid", gap: 14 }} data-checkout-form>
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

                <p className={ipStyles.bodyTextMutedBlock}>
                  Аккаунт: {account.email}. Сюда придут статус заказа, чек и ссылка для продолжения настройки.
                </p>

                <label style={{ display: "grid", gridTemplateColumns: "22px 1fr", gap: 10, alignItems: "start", fontSize: ".88rem", lineHeight: 1.5 }}>
                  <input type="checkbox" name="acceptTerms" required style={{ width: 18, height: 18, marginTop: 2 }} />
                  <span>
                    Я принимаю <Link href="/terms" target="_blank">публичную оферту</Link> и подтверждаю выбранные срок и стоимость.
                  </span>
                </label>

                <label style={{ display: "grid", gridTemplateColumns: "22px 1fr", gap: 10, alignItems: "start", fontSize: ".88rem", lineHeight: 1.5 }}>
                  <input type="checkbox" name="acceptPersonalData" required style={{ width: 18, height: 18, marginTop: 2 }} />
                  <span>
                    Я отдельно даю <Link href="/personal-data-consent" target="_blank">согласие на обработку персональных данных</Link> и ознакомлен с <Link href="/privacy" target="_blank">политикой</Link>.
                  </span>
                </label>

                {error === "agency" ? <p role="alert" style={{ margin: 0 }}>Укажите корректное название агентства или команды.</p> : null}
                {error === "legal" ? <p role="alert" style={{ margin: 0 }}>Для оплаты нужно отдельно подтвердить оферту и согласие на обработку данных.</p> : null}

                <button type="submit" className={ppStyles.primaryAction}>
                  Оплатить {plan.price} через Robokassa
                </button>
                <p className={ipStyles.bodyTextMutedBlock} style={{ textAlign: "center", margin: 0 }}>
                  После нажатия откроется защищённая платёжная страница Robokassa. Доступ включится только после серверного подтверждения оплаты.
                </p>
              </form>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                <p className={ipStyles.bodyTextMutedBlock}>
                  Сначала подтвердите рабочий e-mail. Заказ будет привязан к аккаунту, поэтому статус оплаты и настройки не потеряются.
                </p>
                <Link href={loginHref} className={ppStyles.primaryAction}>Войти или создать аккаунт</Link>
              </div>
            )}
          </div>
        </ContentCard>

        <InternalBackLink href={previewHref}>Изменить параметры радара</InternalBackLink>
      </div>
    </InternalPageFrame>
  );
}

function TrustItem({ title, text }: { title: string; text: string }) {
  return (
    <div style={{ padding: 13, border: "1px solid rgba(15,23,42,.08)", borderRadius: 12 }}>
      <strong style={{ display: "block", fontSize: ".83rem" }}>{title}</strong>
      <span style={{ display: "block", marginTop: 4, color: "#667085", fontSize: ".76rem" }}>{text}</span>
    </div>
  );
}
