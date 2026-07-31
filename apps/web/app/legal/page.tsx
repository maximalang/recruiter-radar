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

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Реквизиты — Recruiter Radar",
  description: "Публичные реквизиты и контакты оператора Recruiter Radar.",
  robots: { index: true, follow: true },
};

export default function LegalPage() {
  return (
    <PageFrame maxWidth="820px">
      <section style={{ display: "grid", gap: "18px", padding: "32px 0" }}>
        <SectionIntro
          eyebrow="Реквизиты"
          title="Реквизиты оператора сервиса"
          description="Полные публичные сведения продавца информационно-аналитических услуг Recruiter Radar."
        />

        <SurfaceCard>
          <div style={{ display: "grid", gap: "14px" }}>
            <SummaryRow label="ФИО" value={OPERATOR_REQUISITES.fullName} />
            <SummaryRow
              label="ИНН"
              value={<span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "1.05em" }}>{OPERATOR_REQUISITES.inn}</span>}
            />
            <SummaryRow label="Статус" value={OPERATOR_REQUISITES.status} />
            <SummaryRow label="ОГРН / ОГРНИП" value={OPERATOR_REQUISITES.ogrnNote} />
            <SummaryRow label="Сервис" value={OPERATOR_REQUISITES.service} />
            <SummaryRow
              label="Сайт"
              value={<a href={OPERATOR_REQUISITES.website} style={{ color: "inherit" }}>{OPERATOR_REQUISITES.website}</a>}
            />
            <SummaryRow
              label="E-mail"
              value={<a href={`mailto:${OPERATOR_REQUISITES.email}`} style={{ color: "inherit" }}>{OPERATOR_REQUISITES.email}</a>}
            />
            <SummaryRow
              label="Телефон"
              value={<a href="tel:+79009666092" style={{ color: "inherit" }}>{OPERATOR_REQUISITES.phone}</a>}
            />
            {OPERATOR_REQUISITES.postalAddress ? (
              <SummaryRow label="Адрес для корреспонденции" value={OPERATOR_REQUISITES.postalAddress} />
            ) : null}
          </div>
        </SurfaceCard>

        {!OPERATOR_REQUISITES.postalAddress ? (
          <NoticeBox
            tone="warning"
            title="Адрес для корреспонденции ещё не опубликован"
            description="До передачи сайта на модерацию ЮKassa необходимо указать фактический адрес в OPERATOR_PUBLIC_POSTAL_ADDRESS. Временный или выдуманный адрес не выводится."
          />
        ) : null}

        <NoticeBox
          tone="info"
          title="Чек плательщика НПД"
          description="После получения оплаты оператор формирует чек в приложении «Мой налог» либо через разрешённого оператора и направляет его заказчику. ЮKassa обрабатывает платёж, но не заменяет чек НПД. При возврате оператор корректирует чек по основанию «Возврат средств»."
        />
      </section>
      <SiteFooter />
    </PageFrame>
  );
}
