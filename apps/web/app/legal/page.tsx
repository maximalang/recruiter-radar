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
  description:
    "Реквизиты самозанятого — плательщика НПД, оператора сервиса Recruiter Radar.",
  robots: { index: true, follow: true },
};

const SELF_EMPLOYED = OPERATOR_REQUISITES;

export default function LegalPage() {
  return (
    <PageFrame maxWidth="820px">
      <section style={{ display: "grid", gap: "18px", padding: "32px 0" }}>
        <SectionIntro
          eyebrow="Реквизиты"
          title="Реквизиты оператора сервиса"
          description="Оператор Recruiter Radar — самозанятый, плательщик налога на профессиональный доход (НПД)."
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
            <SummaryRow label="Сервис" value={SELF_EMPLOYED.service} />
            <SummaryRow
              label="E-mail"
              value={
                <a href={`mailto:${SELF_EMPLOYED.email}`} style={{ color: "inherit" }}>
                  {SELF_EMPLOYED.email}
                </a>
              }
            />
            <SummaryRow
              label="Телефон"
              value={
                <a href="tel:+79009666092" style={{ color: "inherit" }}>
                  {SELF_EMPLOYED.phone}
                </a>
              }
            />
          </div>
        </SurfaceCard>

        <NoticeBox
          tone="info"
          title="Чек плательщика НПД"
          description="После оплаты оператор формирует чек в приложении «Мой налог» и направляет его заказчику в электронной форме. ЮKassa обрабатывает платёж, но не заменяет чек плательщика НПД."
        />
      </section>
      <SiteFooter />
    </PageFrame>
  );
}
