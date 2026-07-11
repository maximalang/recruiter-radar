import type { Metadata } from "next";
import Link from "next/link";

import { PageFrame, SectionIntro, SurfaceCard } from "../ui/page-primitives";

export const metadata: Metadata = {
  title: "Оферта — Recruiter Radar",
  description:
    "Условия оказания услуг сервиса Recruiter Radar. Публичная оферта для самозанятого — оператора сервиса.",
  robots: { index: true, follow: true },
};

const OPERATOR = {
  fullName: "Головий Наталья Ярославна",
  inn: "622809740837",
  status: "Самозанятый, плательщик НПД (налог на профессиональный доход)",
  email: "6uunn9@gmail.com",
  service: "Recruiter Radar — ежедневный радар по компаниям с активным наймом",
};

export default function TermsPage() {
  return (
    <PageFrame maxWidth="820px">
      <section style={{ display: "grid", gap: "18px", padding: "32px 0" }}>
        <SectionIntro
          eyebrow="Документ"
          title="Публичная оферта"
          description="Использование сервиса Recruiter Radar означает согласие с условиями ниже. Договор-оферта вступает в силу с момента оплаты выбранного тарифа."
        />

        <SurfaceCard>
          <div style={{ display: "grid", gap: "10px" }}>
            <SummaryRow label="Оператор" value={OPERATOR.fullName} />
            <SummaryRow label="ИНН" value={OPERATOR.inn} />
            <SummaryRow label="Статус" value={OPERATOR.status} />
            <SummaryRow label="Сервис" value={OPERATOR.service} />
            <SummaryRow label="Контакт" value={<a href={`mailto:${OPERATOR.email}`} style={{ color: "inherit" }}>{OPERATOR.email}</a>} />
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <TermsSection n="1" title="Предмет договора">
            Оператор предоставляет Заказчику доступ к сервису Recruiter Radar — ежедневной подборке
            компаний с признаками активного найма, с доказательствами сигнала, оценкой уверенности
            (confidence) и подсказкой законного пути первого контакта. Доступ предоставляется через
            веб-интерфейс и/или доставку дайджеста в Telegram. Сервис оказывает информационно-аналитические
            услуги и не осуществляет подбор кандидатов, рассылку сообщений от имени Заказчика и не выступает
            кадровым агентством.
          </TermsSection>
        </SurfaceCard>

        <SurfaceCard>
          <TermsSection n="2" title="Тарифы и оплата">
            <p>Стоимость услуг определяется выбранным тарифом и указывается на сайте в момент оформления:</p>
            <ul style={{ margin: "8px 0", paddingLeft: "20px", display: "grid", gap: "6px" }}>
              <li><strong>Пилот</strong> — 3 000 ₽, доступ на 7–14 дней, разовая оплата.</li>
              <li><strong>Ассистированный радар</strong> — 15 000 ₽/мес, ежемесячное продление.</li>
              <li><strong>Premium Desk</strong> — 30 000 ₽/мес, ежемесячное продление.</li>
            </ul>
            <p>Оплата принимается через ЮKassa. Чек формируется в соответствии с ФЗ-54 с указанием ИНН самозанятого.</p>
          </TermsSection>
        </SurfaceCard>

        <SurfaceCard>
          <TermsSection n="3" title="Порядок предоставления доступа">
            <p>После оплаты:</p>
            <ol style={{ margin: "8px 0", paddingLeft: "20px", display: "grid", gap: "6px" }}>
              <li>Заказчик получает ссылку на активацию профиля поиска (город, специализация, ключевые слова).</li>
              <li>Оператор настраивает профиль под нишу Заказчика и подключает доставку дайджеста в Telegram.</li>
              <li>Доступ к веб-интерфейсу и ежедневный радар активируются в течение 1 рабочего дня.</li>
            </ol>
            <p>Доступ к сервису — цифровой, предоставляется онлайн через личный кабинет и Telegram. Физической доставки нет.</p>
          </TermsSection>
        </SurfaceCard>

        <SurfaceCard>
          <TermsSection n="4" title="Срок и прекращение">
            Пилот действует 7–14 дней с момента активации. Ежемесячные тарифы действуют до конца оплаченного
            периода и продлеваются при оплате следующего периода. Заказчик вправе отказаться от продления в любой
            момент, прекратив оплату. Возврат за неиспользованные дни ежемесячного тарифа не производится, если
            сервис предоставлялся надлежащим образом.
          </TermsSection>
        </SurfaceCard>

        <SurfaceCard>
          <TermsSection n="5" title="Что сервис НЕ гарантирует">
            Recruiter Radar предоставляет информационно-аналитические данные о сигналах найма и не гарантирует
            заключения сделок Заказчиком, отклика компаний или конкретных результатов найма. Confidence-оценки и
            gating (A/B/C/D) отражают доказательность сигнала, а не вероятность успеха контакта. Заказчик
            принимает решения о выходе на компании самостоятельно и несёт ответственность за соблюдение
            применимого права при контактах.
          </TermsSection>
        </SurfaceCard>

        <SurfaceCard>
          <TermsSection n="6" title="Конфиденциальность и данные">
            Оператор обрабатывает данные Заказчика (контакт, профиль поиска, история обратной связи) в объёме,
            необходимом для оказания услуг. Данные публичных компаний-работодателей собираются из открытых
            источников. Оператор не передаёт данные Заказчика третьим лицам, кроме случаев, требуемых законом.
          </TermsSection>
        </SurfaceCard>

        <SurfaceCard>
          <TermsSection n="7" title="Ответственность и реквизиты">
            Оператор — самозанятый, плательщик НПД. Споры решаются путём переговоров; при недостижении согласия
            — в соответствии с законодательством РФ. Актуальные реквизиты указаны на странице{" "}
            <Link href="/legal" style={{ color: "inherit", textDecoration: "underline" }}>реквизитов</Link>.
          </TermsSection>
        </SurfaceCard>

        <SurfaceCard padding="18px">
          <div style={{ fontSize: "0.9em", color: "var(--c-text-secondary, #475569)" }}>
            <Link href="/" style={{ color: "inherit", textDecoration: "underline" }}>← На главную Recruiter Radar</Link>
            <span style={{ margin: "0 8px" }}>·</span>
            <Link href="/legal" style={{ color: "inherit", textDecoration: "underline" }}>Реквизиты</Link>
          </div>
        </SurfaceCard>
      </section>
    </PageFrame>
  );
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "16px", padding: "8px 0", borderBottom: "1px solid var(--c-border, #e2e8f0)", flexWrap: "wrap" }}>
      <span style={{ color: "var(--c-text-secondary, #475569)", fontSize: "0.92rem" }}>{label}</span>
      <strong style={{ textAlign: "right" }}>{value}</strong>
    </div>
  );
}

function TermsSection({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: "8px" }}>
      <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700 }}>
        {n}. {title}
      </h2>
      <div style={{ color: "var(--c-text-secondary, #475569)", lineHeight: 1.65, fontSize: "0.95rem" }}>
        {children}
      </div>
    </div>
  );
}
