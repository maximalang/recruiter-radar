import type { Metadata } from "next";
import Link from "next/link";

import {
  NoticeBox,
  PageFrame,
  SectionIntro,
  SummaryRow,
  SurfaceCard,
} from "../ui/page-primitives";
import { SiteFooter } from "../ui/site-footer";
import { OPERATOR_REQUISITES } from "../../lib/operatorRequisites";

export const metadata: Metadata = {
  title: "Реквизиты — Recruiter Radar",
  description:
    "Полные публичные реквизиты самозанятого — оператора информационно-аналитического сервиса Recruiter Radar.",
  robots: { index: true, follow: true },
};

const SELF_EMPLOYED = OPERATOR_REQUISITES;

export default function LegalPage() {
  return (
    <PageFrame maxWidth="820px">
      <section style={{ display: "grid", gap: "18px", padding: "32px 0" }}>
        <SectionIntro
          eyebrow="Реквизиты"
          title="Реквизиты продавца и оператора сервиса"
          description="Recruiter Radar оказывает цифровые информационно-аналитические услуги. Оператор зарегистрирован как самозанятый и применяет налог на профессиональный доход."
        />

        <SurfaceCard>
          <div style={{ display: "grid", gap: "14px" }}>
            <SummaryRow label="ФИО" value={SELF_EMPLOYED.fullName} />
            <SummaryRow
              label="ИНН"
              value={
                <span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "1.05em" }}>
                  {SELF_EMPLOYED.inn}
                </span>
              }
            />
            <SummaryRow label="Статус" value={SELF_EMPLOYED.status} />
            <SummaryRow label="ОГРН / ОГРНИП" value={SELF_EMPLOYED.ogrnNote} />
            <SummaryRow label="Наименование сервиса" value={SELF_EMPLOYED.brandName} />
            <SummaryRow label="Вид услуг" value={SELF_EMPLOYED.service} />
            <SummaryRow
              label="Сайт"
              value={<a href={SELF_EMPLOYED.website} style={{ color: "inherit" }}>{SELF_EMPLOYED.website}</a>}
            />
            <SummaryRow
              label="E-mail поддержки"
              value={
                <a href={`mailto:${SELF_EMPLOYED.email}`} style={{ color: "inherit" }}>
                  {SELF_EMPLOYED.email}
                </a>
              }
            />
            {SELF_EMPLOYED.phone ? (
              <SummaryRow
                label="Телефон"
                value={<a href={`tel:${SELF_EMPLOYED.phone.replace(/[^+\d]/g, "")}`} style={{ color: "inherit" }}>{SELF_EMPLOYED.phone}</a>}
              />
            ) : null}
            {SELF_EMPLOYED.postalAddress ? (
              <SummaryRow label="Адрес для корреспонденции" value={SELF_EMPLOYED.postalAddress} />
            ) : null}
          </div>
        </SurfaceCard>

        <NoticeBox
          tone="info"
          title="Оплата и чек"
          description="Платёж на сайте обрабатывает ЮKassa. После подтверждения оплаты оператор формирует чек плательщика НПД в приложении «Мой налог» и направляет его заказчику в электронной форме."
        />

        <p style={{ margin: 0 }}>
          Порядок оформления, предоставления цифрового доступа и возврата средств описан на странице{" "}
          <Link href="/payment-and-delivery">«Оплата и возврат»</Link>.
        </p>
      </section>
      <SiteFooter />
    </PageFrame>
  );
}
