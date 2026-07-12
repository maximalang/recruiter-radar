import type { Metadata } from "next";
import Link from "next/link";

import { PageFrame, SectionIntro, SurfaceCard } from "../ui/page-primitives";
import { SiteFooter } from "../ui/site-footer";

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

        <SurfaceCard padding="18px">
          <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap", color: "var(--c-text-secondary, #475569)", fontSize: "0.92rem" }}>
            <strong style={{ color: "var(--c-text-primary, #0f172a)" }}>Оператор:</strong>
            <span>{OPERATOR.fullName}</span>
            <span style={{ color: "var(--c-text-muted, #94a3b8)" }}>·</span>
            <span>самозанятый, ИНН {OPERATOR.inn}</span>
            <span style={{ color: "var(--c-text-muted, #94a3b8)" }}>·</span>
            <Link href="/legal" style={{ color: "inherit", textDecoration: "underline" }}>полные реквизиты</Link>
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <TermsSection n="1" title="Предмет договора">
            Оператор предоставляет Заказчику доступ к сервису Recruiter Radar — ежедневной подборке
            компаний с признаками активного найма, с доказательствами сигнала, оценкой уверенности
            и подсказкой законного пути первого контакта. Доступ предоставляется через
            веб-интерфейс и/или доставку дайджеста в Telegram. Сервис оказывает информационно-аналитические
            услуги и не осуществляет подбор кандидатов, рассылку сообщений от имени Заказчика и не выступает
            кадровым агентством.
          </TermsSection>
        </SurfaceCard>

        <SurfaceCard>
          <TermsSection n="2" title="Тарифы и оплата">
            <p>Все тарифы предоставляют одинаковый набор возможностей — радар, профиль поиска, доставка в Telegram, обратную связь и подавление нерелевантных компаний. Тарифы отличаются только сроком действия:</p>
            <ul style={{ margin: "8px 0", paddingLeft: "20px", display: "grid", gap: "6px" }}>
              <li><strong>Неделя</strong> — 2 990 ₽, доступ на 7 дней, разовая оплата.</li>
              <li><strong>Месяц</strong> — 14 990 ₽, доступ на 30 дней.</li>
              <li><strong>Три месяца</strong> — 29 990 ₽, доступ на 90 дней (экономия 14 980 ₽).</li>
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
            Тариф «Неделя» действует 7 дней с момента активации. Тарифы «Месяц» и «Три месяца» действуют до конца оплаченного
            периода (30 и 90 дней соответственно). Заказчик вправе не продлевать тариф по истечении оплаченного
            срока. Возврат за неиспользованные дни не производится, если сервис предоставлялся надлежащим образом.
          </TermsSection>
        </SurfaceCard>

        <SurfaceCard>
          <TermsSection n="5" title="Что сервис НЕ гарантирует">
            Recruiter Radar предоставляет информационно-аналитические данные о сигналах найма и не гарантирует
            заключения сделок Заказчиком, отклика компаний или конкретных результатов найма. Оценки уверенности
            по каждой компании отражают надёжность сигнала, а не вероятность успеха контакта. Заказчик
            принимает решения о выходе на компании самостоятельно и несёт ответственность за соблюдение
            применимого права при контактах.
          </TermsSection>
        </SurfaceCard>

        <SurfaceCard>
          <TermsSection n="6" title="Конфиденциальность и данные">
            Оператор обрабатывает данные Заказчика (контакт, профиль поиска, история обратной связи) в объёме,
            необходимом для оказания услуг. Данные публичных компаний-работодателей собираются из открытых
            источников. Оператор не передаёт данные Заказчика третьим лицам, кроме случаев, требуемых законом.
            Подробно порядок обработки персональных данных описан в{" "}
            <Link href="/privacy" style={{ color: "inherit", textDecoration: "underline" }}>политике конфиденциальности</Link>.
          </TermsSection>
        </SurfaceCard>

        <SurfaceCard>
          <TermsSection n="7" title="Ответственность и реквизиты">
            Оператор — самозанятый, плательщик НПД. Споры решаются путём переговоров; при недостижении согласия
            — в соответствии с законодательством РФ. Актуальные реквизиты указаны на странице{" "}
            <Link href="/legal" style={{ color: "inherit", textDecoration: "underline" }}>реквизитов</Link>.
          </TermsSection>
        </SurfaceCard>
      </section>
      <SiteFooter />
    </PageFrame>
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
