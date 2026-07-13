import type { Metadata } from "next";
import Link from "next/link";

import { PageFrame, SectionIntro } from "../ui/page-primitives";
import { SiteFooter } from "../ui/site-footer";
import s from "../ui/legal-document.module.css";

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
    <PageFrame maxWidth="760px">
      <section className={s.docSection}>
        <SectionIntro
          eyebrow="Документ"
          title="Публичная оферта"
          description="Использование сервиса Recruiter Radar означает согласие с условиями ниже. Договор-оферта вступает в силу с момента оплаты выбранного тарифа."
        />

        {/* Operator line — a single quiet intro, not a card. Full requisites on /legal. */}
        <p className={s.docOperator}>
          Оператор: <strong>{OPERATOR.fullName}</strong>, самозанятый, ИНН {OPERATOR.inn}.{" "}
          <Link href="/legal" className={s.docLink}>Полные реквизиты</Link>.
        </p>

        {/* The document body — one continuous prose flow with numbered section
            headings, NOT a stack of cards. A legal document should read as a
            document: headings + paragraphs, separated by whitespace, no card
            chrome around every clause. */}
        <div className={s.docBody}>
          <TermsSection n="1" title="Предмет договора">
            Оператор предоставляет Заказчику доступ к сервису Recruiter Radar — ежедневной подборке
            компаний с признаками активного найма, с доказательствами сигнала, оценкой уверенности
            и подсказкой законного пути первого контакта. Доступ предоставляется через
            веб-интерфейс и/или доставку дайджеста в Telegram. Сервис оказывает информационно-аналитические
            услуги и не осуществляет подбор кандидатов, рассылку сообщений от имени Заказчика и не выступает
            кадровым агентством.
          </TermsSection>

          <TermsSection n="2" title="Тарифы и оплата">
            <p>Все тарифы предоставляют одинаковый набор возможностей — радар, профиль поиска, доставка в Telegram, обратную связь и подавление нерелевантных компаний. Тарифы отличаются только сроком действия:</p>
            <ul className={s.docList}>
              <li><strong>Неделя</strong> — 2 990 ₽, доступ на 7 дней, разовая оплата.</li>
              <li><strong>Месяц</strong> — 14 990 ₽, доступ на 30 дней.</li>
              <li><strong>Три месяца</strong> — 29 990 ₽, доступ на 90 дней (экономия 14 980 ₽).</li>
            </ul>
            <p>Оплата принимается через ЮKassa. Чек формируется в соответствии с ФЗ-54 с указанием ИНН самозанятого.</p>
          </TermsSection>

          <TermsSection n="3" title="Порядок предоставления доступа">
            <p>После оплаты:</p>
            <ol className={s.docList}>
              <li>Заказчик получает ссылку на активацию профиля поиска (город, специализация, ключевые слова).</li>
              <li>Оператор настраивает профиль под нишу Заказчика и подключает доставку дайджеста в Telegram.</li>
              <li>Доступ к веб-интерфейсу и ежедневный радар активируются в течение 1 рабочего дня.</li>
            </ol>
            <p>Доступ к сервису — цифровой, предоставляется онлайн через личный кабинет и Telegram. Физической доставки нет.</p>
          </TermsSection>

          <TermsSection n="4" title="Срок и прекращение">
            Тариф «Неделя» действует 7 дней с момента активации. Тарифы «Месяц» и «Три месяца» действуют до конца оплаченного
            периода (30 и 90 дней соответственно). Заказчик вправе не продлевать тариф по истечении оплаченного
            срока. Возврат за неиспользованные дни не производится, если сервис предоставлялся надлежащим образом.
          </TermsSection>

          <TermsSection n="5" title="Что сервис НЕ гарантирует">
            Recruiter Radar предоставляет информационно-аналитические данные о сигналах найма и не гарантирует
            заключения сделок Заказчиком, отклика компаний или конкретных результатов найма. Оценки уверенности
            по каждой компании отражают надёжность сигнала, а не вероятность успеха контакта. Заказчик
            принимает решения о выходе на компании самостоятельно и несёт ответственность за соблюдение
            применимого права при контактах.
          </TermsSection>

          <TermsSection n="6" title="Конфиденциальность и данные">
            Оператор обрабатывает данные Заказчика (контакт, профиль поиска, история обратной связи) в объёме,
            необходимом для оказания услуг. Данные публичных компаний-работодателей собираются из открытых
            источников. Оператор не передаёт данные Заказчика третьим лицам, кроме случаев, требуемых законом.
            Подробно порядок обработки персональных данных описан в{" "}
            <Link href="/privacy" className={s.docLink}>политике конфиденциальности</Link>.
          </TermsSection>

          <TermsSection n="7" title="Ответственность и реквизиты">
            Оператор — самозанятый, плательщик НПД. Споры решаются путём переговоров; при недостижении согласия
            — в соответствии с законодательством РФ. Актуальные реквизиты указаны на странице{" "}
            <Link href="/legal" className={s.docLink}>реквизитов</Link>.
          </TermsSection>
        </div>
      </section>
      <SiteFooter />
    </PageFrame>
  );
}

function TermsSection({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className={s.docClause}>
      <h2 className={s.docClauseTitle}>{n}. {title}</h2>
      <div className={s.docClauseText}>{children}</div>
    </section>
  );
}
