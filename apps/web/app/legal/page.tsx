import type { Metadata } from "next";
import Link from "next/link";

import {
  PageFrame,
  SectionIntro,
  SummaryRow,
  SurfaceCard,
} from "../ui/page-primitives";
import { LegalDocumentNav } from "../ui/legal-document-nav";
import { SiteFooter } from "../ui/site-footer";
import { OPERATOR_REQUISITES } from "../../lib/operatorRequisites";
import s from "../ui/legal-document.module.css";

export const metadata: Metadata = {
  title: "Реквизиты продавца — Recruiter Radar",
  description: "Публичные реквизиты самозанятого продавца и оператора Recruiter Radar.",
  robots: { index: true, follow: true },
};

export default function LegalPage() {
  const requisites = OPERATOR_REQUISITES;

  return (
    <PageFrame maxWidth="820px">
      <section className={s.docSection}>
        <LegalDocumentNav current="/legal" />
        <SectionIntro
          eyebrow="Публичные реквизиты"
          title="Продавец и оператор Recruiter Radar"
          description="Подтверждённые данные самозанятого, который предоставляет цифровой доступ к сервису и принимает оплату."
        />

        <div className={s.docSummary}>
          <Summary label="Статус" value="Самозанятый · НПД" />
          <Summary label="Город" value={requisites.city} />
          <Summary label="Поддержка" value={requisites.email} />
        </div>

        <SurfaceCard>
          <div style={{ display: "grid", gap: "14px" }}>
            <SummaryRow label="Продавец" value={`Самозанятый ${requisites.fullName}`} />
            <SummaryRow
              label="ИНН"
              value={
                <span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "1.05em" }}>
                  {requisites.inn}
                </span>
              }
            />
            <SummaryRow label="Налоговый статус" value={requisites.status} />
            <SummaryRow label="Регистрация" value={requisites.ogrnNote} />
            <SummaryRow label="Город" value={requisites.city} />
            {requisites.postalAddress ? <SummaryRow label="Адрес для корреспонденции" value={requisites.postalAddress} /> : null}
            <SummaryRow label="Бренд" value={requisites.brandName} />
            <SummaryRow label="Услуга" value={requisites.service} />
            <SummaryRow
              label="E-mail поддержки"
              value={<a href={`mailto:${requisites.email}`} style={{ color: "inherit" }}>{requisites.email}</a>}
            />
            <SummaryRow
              label="Телефон"
              value={<a href="tel:+79009666092" style={{ color: "inherit" }}>{requisites.phone}</a>}
            />
            <SummaryRow
              label="Сайт"
              value={<a href={requisites.website} style={{ color: "inherit" }}>{requisites.website}</a>}
            />
          </div>
        </SurfaceCard>

        <p className={s.docCallout}>
          <strong>Как предоставляется услуга.</strong> Recruiter Radar — цифровой информационно-аналитический сервис. Физической доставки нет: оплаченный доступ активируется в аккаунте после серверного подтверждения платежа.
        </p>

        <div className={s.docBody}>
          <LegalSection n="1" title="Оплата и чек">
            <p>Оплата проводится через защищённую платёжную страницу Robokassa. Продавец применяет НПД и после получения расчёта формирует электронный чек через «Мой налог» или подключённый сервис «Робочеки СМЗ».</p>
            <p>При покупке от ООО или ИП указывается ИНН покупателя для корректного оформления чека. Подробный порядок размещён на странице <Link href="/payment-and-refund" className={s.docLink}>«Оплата и возврат»</Link>.</p>
          </LegalSection>

          <LegalSection n="2" title="Поддержка и юридически значимые обращения">
            <p>Вопросы по заказу, доступу, чеку, возврату и персональным данным направляются на <a href={`mailto:${requisites.email}`} className={s.docLink}>{requisites.email}</a>. В обращении следует указать e-mail аккаунта и номер заказа, если он уже создан.</p>
            <p>Телефон поддержки: <a href="tel:+79009666092" className={s.docLink}>{requisites.phone}</a>. Письменный канал является основным для фиксации содержания и даты обращения.</p>
          </LegalSection>

          <LegalSection n="3" title="Связанные документы">
            <p>Условия оказания услуги содержатся в <Link href="/terms" className={s.docLink}>публичной оферте</Link>, правила обработки данных — в <Link href="/privacy" className={s.docLink}>политике обработки персональных данных</Link>, отдельное согласие — на странице <Link href="/personal-data-consent" className={s.docLink}>«Согласие ПДн»</Link>.</p>
          </LegalSection>
        </div>
      </section>
      <SiteFooter />
    </PageFrame>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.docSummaryItem}>
      <span className={s.docSummaryLabel}>{label}</span>
      <span className={s.docSummaryValue}>{value}</span>
    </div>
  );
}

function LegalSection({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className={s.docClause}>
      <h2 className={s.docClauseTitle}>{n}. {title}</h2>
      <div className={s.docClauseText}>{children}</div>
    </section>
  );
}
