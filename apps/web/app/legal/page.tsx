import type { Metadata } from "next";

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
  description: "Публичные реквизиты самозанятого продавца и оператора Recruiter Radar.",
  robots: { index: true, follow: true },
};

export default function LegalPage() {
  const requisites = OPERATOR_REQUISITES;

  return (
    <PageFrame maxWidth="820px">
      <section style={{ display: "grid", gap: "18px", padding: "32px 0" }}>
        <SectionIntro
          eyebrow="Реквизиты"
          title="Реквизиты продавца"
          description="Данные самозанятого продавца, принимающего оплату за цифровой доступ к Recruiter Radar."
        />

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
            <SummaryRow label="Услуга" value={requisites.service} />
            <SummaryRow
              label="E-mail"
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
            {requisites.postalAddress ? (
              <SummaryRow label="Адрес для корреспонденции" value={requisites.postalAddress} />
            ) : null}
          </div>
        </SurfaceCard>

        {requisites.postalAddress ? null : (
          <NoticeBox
            tone="warning"
            title="Адрес будет добавлен до модерации"
            description="Для подачи сайта на модерацию платёжного оператора необходимо указать фактический адрес для корреспонденции. Временный или выдуманный адрес публично не показывается."
          />
        )}

        <NoticeBox
          tone="info"
          title="Чек НПД"
          description="После оплаты продавец формирует чек плательщика НПД через «Мой налог» или подключённого оператора электронной площадки и передаёт его покупателю. Онлайн-касса по 54-ФЗ для плательщика НПД не применяется."
        />
      </section>
      <SiteFooter />
    </PageFrame>
  );
}
