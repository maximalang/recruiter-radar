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
    "Реквизиты самозанятого — плательщика НПД, оператора сервиса Recruiter Radar. ИНН для оплаты через ЮKassa.",
  robots: { index: true, follow: true },
};

// The requisites live in lib/operatorRequisites (the single source the footer
// and this page share). This page renders the full block (status + service
// description); the footer carries only the legally-required minimum + a link
// here. ИНН is the operational key for ЮKassa receipts (ФЗ-54).
const SELF_EMPLOYED = OPERATOR_REQUISITES;

export default function LegalPage() {
  return (
    <PageFrame maxWidth="820px">
      <section style={{ display: "grid", gap: "18px", padding: "32px 0" }}>
        <SectionIntro
          eyebrow="Реквизиты"
          title="Реквизиты оператора сервиса"
          description="Оператор Recruiter Radar — самозанятый, плательщик налога на профессиональный доход (НПД). Реквизиты применяются при формировании чеков через ЮKassa."
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
              label="Контакт"
              value={
                <a href={`mailto:${SELF_EMPLOYED.email}`} style={{ color: "inherit" }}>
                  {SELF_EMPLOYED.email}
                </a>
              }
            />
          </div>
        </SurfaceCard>

        <NoticeBox
          tone="info"
          title="ИНН для оплаты"
          description="Этот ИНН применяется при формировании чеков через ЮKassa в соответствии с ФЗ-54. Полные условия оказания услуг — в оферте."
        />
      </section>
      <SiteFooter />
    </PageFrame>
  );
}
