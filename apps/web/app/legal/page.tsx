import type { Metadata } from "next";
import Link from "next/link";

import {
  NoticeBox,
  PageFrame,
  SectionIntro,
  SummaryRow,
  SurfaceCard,
} from "../ui/page-primitives";

export const metadata: Metadata = {
  title: "Реквизиты — Recruiter Radar",
  description:
    "Реквизиты самозанятого — плательщика НПД, оператора сервиса Recruiter Radar. ИНН для оплаты через ЮKassa.",
  robots: { index: true, follow: true },
};

// Реквизиты оператора сервиса. ИНН указан явно — требуется для приёма оплат
// через ЮKassa (самозанятый, плательщик НПД). Эта страница — единый источник
// реквизитов; оферта и политика ссылаются сюда и не дублируют блок целиком.
const SELF_EMPLOYED = {
  fullName: "Головий Наталья Ярославна",
  inn: "622809740837",
  status: "Самозанятый, плательщик НПД (налог на профессиональный доход)",
  service: "Recruiter Radar — ежедневный радар по компаниям с активным наймом",
  email: "6uunn9@gmail.com",
};

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

        <SurfaceCard padding="18px">
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", fontSize: "0.92rem", color: "var(--c-text-secondary, #475569)" }}>
            <Link href="/" style={{ color: "inherit", textDecoration: "underline" }}>← На главную</Link>
            <span style={{ color: "var(--c-text-muted, #94a3b8)" }}>·</span>
            <Link href="/terms" style={{ color: "inherit", textDecoration: "underline" }}>Оферта</Link>
            <span style={{ color: "var(--c-text-muted, #94a3b8)" }}>·</span>
            <Link href="/privacy" style={{ color: "inherit", textDecoration: "underline" }}>Конфиденциальность</Link>
          </div>
        </SurfaceCard>
      </section>
    </PageFrame>
  );
}
