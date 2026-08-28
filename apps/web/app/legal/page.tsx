import type { Metadata } from "next";
import Link from "next/link";

import { LEGAL_DOCUMENTS } from "@/lib/legalDocuments";
import { OPERATOR_REQUISITES } from "@/lib/operatorRequisites";
import { PageFrame, SectionIntro, SummaryRow, SurfaceCard } from "../ui/page-primitives";
import { LegalDocumentNav } from "../ui/legal-document-nav";
import { SiteFooter } from "../ui/site-footer";
import s from "../ui/legal-document.module.css";

export const metadata: Metadata = {
  title: "Реквизиты продавца и правовые документы — Recruiter Radar",
  description:
    "Публичные реквизиты самозанятого продавца и оператора Recruiter Radar, действующие редакции оферты, политики, согласия и правил сервиса.",
  robots: { index: true, follow: true },
};

const DOCUMENT_GROUPS: ReadonlyArray<{
  group: string;
  documents: ReadonlyArray<{ href: string; label: string; revisionKey?: keyof typeof LEGAL_DOCUMENTS; note?: string }>;
}> = [
  {
    group: "Условия",
    documents: [
      { href: "/terms", label: "Публичная оферта", revisionKey: "terms" },
      { href: "/payment-and-refund", label: "Оплата и возврат", revisionKey: "paymentAndRefund" },
      { href: "/acceptable-use", label: "Правила использования", revisionKey: "acceptableUse" },
    ],
  },
  {
    group: "Персональные данные",
    documents: [
      { href: "/privacy", label: "Политика обработки", revisionKey: "privacy" },
      { href: "/personal-data-consent", label: "Согласие на обработку", revisionKey: "personalDataConsent" },
      { href: "/data-policy", label: "Публичные источники и исправление данных", revisionKey: "dataPolicy" },
    ],
  },
  {
    group: "Cookies и аналитика",
    documents: [{ href: "/cookies", label: "Cookies и аналитика", revisionKey: "cookies" }],
  },
] as const;

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
              value={<a href={`tel:${requisites.phone.replace(/[^+\d]/g, "")}`} style={{ color: "inherit" }}>{requisites.phone}</a>}
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
          <section className={s.docClause}>
            <h2 className={s.docClauseTitle}>Действующие документы</h2>
            <div className={s.docClauseText}>
              <p>Актуальные редакции правовых документов сервиса. Для каждого заказа фиксируются ревизии принятых документов на момент оформления.</p>
              <div className={s.docTableWrap}>
                <table className={s.docTable}>
                  <thead><tr><th scope="col">Документ</th><th scope="col">Редакция от</th></tr></thead>
                  <tbody>
                    {DOCUMENT_GROUPS.flatMap((group) => group.documents).map((document) => (
                      <tr key={document.href}>
                        <td><Link href={document.href} className={s.docLink}>{document.label}</Link></td>
                        <td>{document.revisionKey ? LEGAL_DOCUMENTS[document.revisionKey].displayDate : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className={s.docClause}>
            <h2 className={s.docClauseTitle}>1. Оплата и чек</h2>
            <div className={s.docClauseText}>
              <p>Оплата проводится через защищённую платёжную страницу Robokassa. Продавец применяет НПД и после получения расчёта формирует электронный чек через «Мой налог» или подключённый сервис «Робочеки СМЗ».</p>
              <p>При покупке от ООО или ИП указывается ИНН покупателя для корректного оформления чека. Подробный порядок размещён на странице <Link href="/payment-and-refund" className={s.docLink}>«Оплата и возврат»</Link>.</p>
            </div>
          </section>

          <section className={s.docClause}>
            <h2 className={s.docClauseTitle}>2. Поддержка и юридически значимые обращения</h2>
            <div className={s.docClauseText}>
              <p>Вопросы по заказу, доступу, чеку, возврату и персональным данным направляются на <a href={`mailto:${requisites.email}`} className={s.docLink}>{requisites.email}</a>. В обращении следует указать e-mail аккаунта и номер заказа, если он уже создан.</p>
              <p>Телефон поддержки: <a href={`tel:${requisites.phone.replace(/[^+\d]/g, "")}`} className={s.docLink}>{requisites.phone}</a>. Письменный канал является основным для фиксации содержания и даты обращения.</p>
            </div>
          </section>
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
