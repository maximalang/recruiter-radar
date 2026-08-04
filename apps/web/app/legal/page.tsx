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
            {requisites.city ? <SummaryRow label="Город" value={requisites.city} /> : null}
            {requisites.postalAddress ? (
              <SummaryRow label="Адрес для корреспонденции" value={requisites.postalAddress} />
            ) : null}
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

        {requisites.city || requisites.postalAddress ? null : (
          <NoticeBox
            tone="warning"
            title="До модерации нужно указать город"
            description="Robokassa требует идентифицировать самозанятого продавца в footer. Для самозанятого достаточно города; выдуманный или избыточный домашний адрес не публикуется."
          />
        )}

        <NoticeBox
          tone="info"
          title="Чек НПД"
          description="После оплаты продавец формирует чек плательщика НПД через «Мой налог» или сервис «Робочеки СМЗ» и передаёт его покупателю. Самозанятый на НПД освобождён от применения онлайн-кассы по 54-ФЗ, но обязан выдать чек по каждому расчёту."
        />
      </section>
      <SiteFooter />
    </PageFrame>
  );
}
